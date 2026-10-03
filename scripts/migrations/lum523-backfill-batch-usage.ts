import { config } from 'dotenv'
// Type-only import: erased at compile time, so it does NOT pull in
// session.repository → `@/lib/db/prisma` at module load. That matters because
// ES imports are hoisted ABOVE the `config()` call below — a *value* import that
// transitively constructs the Prisma client would read an unset DATABASE_URL and
// connect to a default/localhost (ECONNREFUSED against the real DB). The only
// thing that constructs Prisma is the dynamic `import('@/lib/db/prisma')` inside
// main(), which runs after config() has loaded the env.
import type { ModelUsage } from '@/lib/repositories/session.repository'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

export interface SnapshotRow {
  id: string
  type: string
  cumulative: Record<string, ModelUsage>
}

/** Per-model per-kind delta (next − prior), clamped >= 0. Inlined mirror of
 * `diffUsageByModel` in session.repository (kept local so this migration script
 * carries no static import that would construct Prisma before dotenv runs —
 * see the import note above). */
function diffClamped(
  prior: Record<string, ModelUsage> | null,
  next: Record<string, ModelUsage>
): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {}
  for (const [model, n] of Object.entries(next)) {
    const p = prior?.[model]
    out[model] = {
      input: Math.max(0, n.input - (p?.input ?? 0)),
      output: Math.max(0, n.output - (p?.output ?? 0)),
      cacheRead: Math.max(0, n.cacheRead - (p?.cacheRead ?? 0)),
      cacheCreation: Math.max(0, n.cacheCreation - (p?.cacheCreation ?? 0)),
    }
  }
  return out
}

/** For one session's ordered batch+STOP rows, the per-STEP delta of each batch
 * vs the previous snapshot (batch or STOP). STOP rows are NOT included (their
 * usageByModel per-turn delta is untouched). */
export function computeBatchDeltasForSession(
  rows: SnapshotRow[]
): Map<string, Record<string, ModelUsage>> {
  const out = new Map<string, Record<string, ModelUsage>>()
  let prev: Record<string, ModelUsage> | null = null
  for (const r of rows) {
    if (r.type === 'POST_TOOL_BATCH') {
      out.set(r.id, diffClamped(prev, r.cumulative))
    }
    prev = r.cumulative
  }
  return out
}

function cumulativeFromPayload(
  payload: unknown
): Record<string, ModelUsage> | null {
  if (!payload || typeof payload !== 'object') return null
  const usage = (payload as Record<string, unknown>)['_lumo_usage']
  if (!usage || typeof usage !== 'object') return null
  const byModel = (usage as Record<string, unknown>)['byModel']
  if (!byModel || typeof byModel !== 'object') return null
  return byModel as Record<string, ModelUsage>
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  // LUM-863: payloads may be stored encrypted.
  const { openHookPayloads } = await import('@/lib/hook-event/payload-cipher')
  const sessions = await prisma.hookEvent.findMany({
    where: { type: 'POST_TOOL_BATCH', sessionId: { not: null } },
    distinct: ['sessionId'],
    select: { sessionId: true },
  })
  let updated = 0
  for (const { sessionId } of sessions) {
    if (!sessionId) continue
    const events = await openHookPayloads(
      await prisma.hookEvent.findMany({
        where: {
          sessionId,
          type: { in: ['POST_TOOL_BATCH', 'STOP', 'STOP_FAILURE'] },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, payload: true, payloadEncrypted: true },
      })
    )
    const rows: SnapshotRow[] = []
    for (const e of events) {
      const cumulative = cumulativeFromPayload(e.payload)
      if (cumulative) rows.push({ id: e.id, type: e.type, cumulative })
    }
    const deltas = computeBatchDeltasForSession(rows)
    for (const [id, delta] of deltas) {
      await prisma.hookEvent.update({
        where: { id },
        data: { usageByModel: delta as unknown as object },
        select: { id: true },
      })
      updated += 1
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Backfilled usageByModel on ${updated} POST_TOOL_BATCH rows`)
  await prisma.$disconnect()
}

if (
  process.env.NODE_ENV !== 'test' &&
  process.argv[1]?.includes('lum523-backfill')
) {
  main().catch(e => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
}
