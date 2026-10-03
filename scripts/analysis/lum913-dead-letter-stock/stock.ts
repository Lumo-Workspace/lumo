/**
 * LUM-913 stock — READ-ONLY tally of dead-lettered PR comment sync jobs.
 * Only `findMany` is called; payloads are inspected in memory for the presence
 * of the webhook body (`raw`) and never returned or printed.
 */
const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 500

export const AGE_BUCKETS = ['<=7d', '8-30d', '31-90d', '>90d'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]

interface StockRow {
  id: string
  workspaceId: string
  direction: string
  payload: unknown
  updatedAt: Date
  deadLetteredAt: Date | null
  payloadPurgedAt: Date | null
}

/** The only DB surface the tally needs — a read. */
export interface StockDb {
  prCommentSyncJob: {
    findMany(args: {
      where: { status: 'DEAD_LETTER'; id?: { gt: string } }
      orderBy: { id: 'asc' }
      take: number
      select: Record<keyof StockRow, true>
    }): Promise<StockRow[]>
  }
}

export interface DeadLetterStock {
  /** Dead-lettered before LUM-913 (no deadLetteredAt): the user-authorized backlog. */
  legacy: {
    rows: number
    withRawPayload: number
    byDirection: Record<string, number>
    byWorkspace: Record<string, number>
    /** Age by `updatedAt` — the last write, i.e. roughly when it dead-lettered. */
    byAge: Record<AgeBucket, number>
    oldest?: Date
    newest?: Date
  }
  /** Dead-lettered after LUM-913 shipped: handled by the daily cron. */
  tracked: { rows: number; purged: number; awaitingPurge: number }
}

function ageBucket(at: Date, now: Date): AgeBucket {
  const days = (now.getTime() - at.getTime()) / DAY_MS
  if (days <= 7) return '<=7d'
  if (days <= 30) return '8-30d'
  if (days <= 90) return '31-90d'
  return '>90d'
}

function hasRaw(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'raw' in payload &&
    (payload as { raw: unknown }).raw != null
  )
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

export async function tallyDeadLetterStock(
  db: StockDb,
  now: Date
): Promise<DeadLetterStock> {
  const stock: DeadLetterStock = {
    legacy: {
      rows: 0,
      withRawPayload: 0,
      byDirection: {},
      byWorkspace: {},
      byAge: { '<=7d': 0, '8-30d': 0, '31-90d': 0, '>90d': 0 },
    },
    tracked: { rows: 0, purged: 0, awaitingPurge: 0 },
  }
  let afterId: string | null = null
  for (;;) {
    const rows: StockRow[] = await db.prCommentSyncJob.findMany({
      where: {
        status: 'DEAD_LETTER',
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: {
        id: true,
        workspaceId: true,
        direction: true,
        payload: true,
        updatedAt: true,
        deadLetteredAt: true,
        payloadPurgedAt: true,
      },
    })
    if (rows.length === 0) break
    for (const r of rows) {
      if (r.deadLetteredAt) {
        stock.tracked.rows++
        if (r.payloadPurgedAt) stock.tracked.purged++
        else stock.tracked.awaitingPurge++
        continue
      }
      const l = stock.legacy
      l.rows++
      if (hasRaw(r.payload)) l.withRawPayload++
      bump(l.byDirection, r.direction)
      bump(l.byWorkspace, r.workspaceId)
      l.byAge[ageBucket(r.updatedAt, now)]++
      if (!l.oldest || r.updatedAt < l.oldest) l.oldest = r.updatedAt
      if (!l.newest || r.updatedAt > l.newest) l.newest = r.updatedAt
    }
    afterId = rows[rows.length - 1]!.id
    if (rows.length < BATCH) break
  }
  return stock
}
