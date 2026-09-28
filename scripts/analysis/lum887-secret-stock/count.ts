/**
 * LUM-887 stock assessment — READ-ONLY. Counts stored rows that still hold a
 * credential shape the pre-LUM-887 registry missed (see classify.ts), per
 * table and per rule. Prints counts only, never a value. findMany only — no
 * writes; whether to re-redact is the user's call.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum887-secret-stock/count.ts [--limit N]
 */
import { classifyRow } from './classify'

const BATCH = 200

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface Tally {
  rows: number
  affected: number
  byRule: Map<string, number>
  workspaces: Set<string>
}

const newTally = (): Tally => ({
  rows: 0,
  affected: 0,
  byRule: new Map(),
  workspaces: new Set(),
})

function record(t: Tally, hits: Set<string>, workspaceId?: string | null) {
  t.rows++
  if (hits.size === 0) return
  t.affected++
  if (workspaceId) t.workspaces.add(workspaceId)
  for (const id of hits) t.byRule.set(id, (t.byRule.get(id) ?? 0) + 1)
}

function print(name: string, t: Tally) {
  console.log(
    `${name}: ${t.affected}/${t.rows} rows affected` +
      (t.workspaces.size ? ` · ${t.workspaces.size} workspace(s)` : '')
  )
  for (const [id, n] of [...t.byRule].sort((a, b) => b[1] - a[1]))
    console.log(`  ${id}: ${n}`)
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const limit = flag('--limit') ? Number(flag('--limit')) : Infinity
  console.log(
    `[read-only] LUM-887 secret stock · db ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`
  )

  // HookEvent — payload + extracted text columns; pruned rows hold no content.
  const hook = newTally()
  const hookCrossing = newTally()
  const crossingIds = new Set(
    (
      await prisma.boundaryCrossing.findMany({
        where: { hookEventId: { not: null } },
        select: { hookEventId: true },
        distinct: ['hookEventId'],
      })
    ).flatMap(r => (r.hookEventId ? [r.hookEventId] : []))
  )
  let cursor: string | undefined
  for (;;) {
    const rows = await prisma.hookEvent.findMany({
      where: { payloadPrunedAt: null },
      select: {
        id: true,
        workspaceId: true,
        payload: true,
        toolDetail: true,
        turnSummary: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows) {
      const hits = classifyRow([r.payload, r.toolDetail, r.turnSummary])
      record(hook, hits, r.workspaceId)
      if (crossingIds.has(r.id)) record(hookCrossing, hits, r.workspaceId)
    }
    cursor = rows[rows.length - 1]!.id
    if (hook.rows % 20000 < BATCH)
      console.error(`  … hookEvent ${hook.rows} scanned (${hook.affected} hit)`)
    if (hook.rows >= limit) break
  }
  print('HookEvent (unpruned)', hook)
  print('  of which crossing-referenced', hookCrossing)

  const finding = newTally()
  cursor = undefined
  for (;;) {
    const rows = await prisma.prSecurityFinding.findMany({
      select: {
        id: true,
        title: true,
        detail: true,
        evidence: true,
        dispositionNote: true,
        suggestedReason: true,
        callChain: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows)
      record(
        finding,
        classifyRow([
          r.title,
          r.detail,
          r.evidence,
          r.dispositionNote,
          r.suggestedReason,
          r.callChain,
        ])
      )
    cursor = rows[rows.length - 1]!.id
  }
  print('PrSecurityFinding', finding)

  const scan = newTally()
  cursor = undefined
  for (;;) {
    const rows = await prisma.prSecurityScan.findMany({
      select: {
        id: true,
        workspaceId: true,
        error: true,
        huntAudit: true,
        stages: true,
        prSummary: true,
        huntJob: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows)
      record(
        scan,
        classifyRow([r.error, r.huntAudit, r.stages, r.prSummary, r.huntJob]),
        r.workspaceId
      )
    cursor = rows[rows.length - 1]!.id
  }
  print('PrSecurityScan', scan)

  const crossing = newTally()
  cursor = undefined
  for (;;) {
    const rows = await prisma.boundaryCrossing.findMany({
      select: {
        id: true,
        detail: true,
        target: true,
        dispositionNote: true,
        systemExplanation: true,
        policyRuleText: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows)
      record(
        crossing,
        classifyRow([
          r.detail,
          r.target,
          r.dispositionNote,
          r.systemExplanation,
          r.policyRuleText,
        ])
      )
    cursor = rows[rows.length - 1]!.id
  }
  print('BoundaryCrossing', crossing)

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
