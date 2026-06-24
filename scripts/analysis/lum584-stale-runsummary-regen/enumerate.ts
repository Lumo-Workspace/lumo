/**
 * LUM-584 — enumerate the stale run-summary regeneration targets in prod.
 *
 * Builds a VerdictTargetRow per task that carries a persisted LUM-582
 * UNDERREPORT verdict, joins it to its anchor (claimSnapshotSessionId) session's
 * Write/Edit event count and run-summary timestamp, and runs the pure
 * `select.ts` classifier. Prints the STALE_REGEN targets (the list to feed
 * `lum579-run-summary-underreport/regenerate.ts --tasks …`) plus the
 * NO_OP_SKIP / POST_579_SKIP buckets so the reverse gate and the residual
 * post-579 cases are visible.
 *
 * READ-ONLY (no LLM, no writes).
 *   export AI_GATEWAY_API_KEY is NOT needed here (no LLM).
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum584-stale-runsummary-regen/enumerate.ts [--json]
 */
import { prisma } from '@/lib/db/prisma'
import {
  classifyTarget,
  type TargetClassification,
  type VerdictTargetRow,
} from './select'

interface ClassifiedRow extends VerdictTargetRow {
  classification: TargetClassification
}

export async function enumerateTargets(): Promise<ClassifiedRow[]> {
  // 1. Every persisted 582 UNDERREPORT verdict, with its task's identifier +
  //    claim anchor.
  const verdicts = await prisma.claimFaithfulnessVerdict.findMany({
    where: { verdict: 'UNDERREPORT' },
    select: {
      verdict: true,
      task: {
        select: {
          id: true,
          number: true,
          team: { select: { identifier: true } },
          claimSnapshotSessionId: true,
          claimSnapshotAt: true,
        },
      },
    },
  })

  const rows: ClassifiedRow[] = []
  for (const v of verdicts) {
    const t = v.task
    const anchorSessionId = t.claimSnapshotSessionId

    // 2. Anchor session's Write/Edit delivery count + run-summary timestamp.
    let writeEditCount = 0
    let runSummaryGeneratedAt: Date | null = null
    if (anchorSessionId) {
      writeEditCount = await prisma.hookEvent.count({
        where: {
          sessionId: anchorSessionId,
          toolName: { in: ['Write', 'Edit'] },
        },
      })
      const session = await prisma.session.findUnique({
        where: { id: anchorSessionId },
        select: { runSummaryGeneratedAt: true },
      })
      runSummaryGeneratedAt = session?.runSummaryGeneratedAt ?? null
    }

    const base: VerdictTargetRow = {
      identifier: `${t.team.identifier}-${t.number}`,
      taskId: t.id,
      verdict: v.verdict,
      anchorSessionId,
      writeEditCount,
      generatedAt: runSummaryGeneratedAt ?? t.claimSnapshotAt,
    }
    rows.push({ ...base, classification: classifyTarget(base) })
  }

  rows.sort((a, b) =>
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  )
  return rows
}

async function main() {
  const json = process.argv.includes('--json')
  const rows = await enumerateTargets()
  const stale = rows.filter(r => r.classification === 'STALE_REGEN')

  if (json) {
    console.log(JSON.stringify(rows, null, 2))
  } else {
    const byClass: Record<string, ClassifiedRow[]> = {}
    for (const r of rows) (byClass[r.classification] ??= []).push(r)
    for (const cls of [
      'STALE_REGEN',
      'NO_OP_SKIP',
      'POST_579_SKIP',
      'NOT_UNDERREPORT',
    ] as TargetClassification[]) {
      const group = byClass[cls] ?? []
      console.log(`\n## ${cls} (${group.length})`)
      for (const r of group) {
        console.log(
          `  ${r.identifier}  write/edit=${r.writeEditCount}  generatedAt=${r.generatedAt?.toISOString() ?? 'null'}`
        )
      }
    }
    console.log(
      `\nUNDERREPORT total=${rows.length}  →  STALE_REGEN targets=${stale.length}`
    )
    console.log(
      `regenerate with:\n  --tasks ${stale.map(r => r.identifier.replace(/^.*-/, '')).join(',')}`
    )
  }
  await prisma.$disconnect()
}

if (process.argv[1]?.endsWith('enumerate.ts')) {
  main().catch(async err => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
}
