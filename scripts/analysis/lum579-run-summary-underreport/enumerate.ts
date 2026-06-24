/**
 * LUM-579 — enumerate the negative-claim DONE tasks (recreates the LUM-577
 * acceptance anchor, whose scripts were never committed).
 *
 * A row is listed when: the task is DONE, its claim snapshot has been
 * synthesized (claimSnapshotAt set), the claim is sourced from the LLM run
 * summary (claimSnapshotSource = 'RUN_SUMMARY'), and the claim text reads as
 * negative (isNegativeClaim). That is the population whose run-summaries the
 * regeneration must repair. The count it prints is `beforeNeg`.
 *
 * READ-ONLY.
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/enumerate.ts [--json]
 */
import { prisma } from '@/lib/db/prisma'
import { isNegativeClaim } from './negative-claim'

export interface NegativeClaimRow {
  taskId: string
  number: number
  title: string
  claimSnapshotSessionId: string | null
  claim: string
}

export async function enumerateNegativeClaims(): Promise<NegativeClaimRow[]> {
  const tasks = await prisma.task.findMany({
    where: {
      status: 'DONE',
      claimSnapshotAt: { not: null },
      claimSnapshotSource: 'RUN_SUMMARY',
      claimSnapshot: { not: null },
    },
    select: {
      id: true,
      number: true,
      title: true,
      claimSnapshot: true,
      claimSnapshotSessionId: true,
    },
    orderBy: { number: 'asc' },
  })

  return tasks
    .filter(t => isNegativeClaim(t.claimSnapshot))
    .map(t => ({
      taskId: t.id,
      number: t.number,
      title: t.title,
      claimSnapshotSessionId: t.claimSnapshotSessionId,
      claim: t.claimSnapshot ?? '',
    }))
}

async function main() {
  const json = process.argv.includes('--json')
  const rows = await enumerateNegativeClaims()

  if (json) {
    console.log(JSON.stringify(rows, null, 2))
  } else {
    for (const r of rows) {
      console.log(`LUM-${r.number}  ${r.title}`)
      console.log(`   ${r.claim.replace(/\s+/g, ' ').slice(0, 160)}…`)
    }
    console.log(`\nbeforeNeg = ${rows.length} negative-claim DONE task(s)`)
  }
  await prisma.$disconnect()
}

// Only run when invoked directly (not when imported by audit.ts/regenerate.ts).
if (process.argv[1]?.includes('enumerate.ts')) {
  main().catch(async err => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
}
