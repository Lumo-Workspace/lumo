/**
 * @jest-environment node
 */
import { tallyDeadLetterStock, type StockDb } from '../stock'

const NOW = new Date('2026-10-20T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function row(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `job_${String(i).padStart(4, '0')}`,
    workspaceId: i % 2 ? 'ws_a' : 'ws_b',
    direction: 'INBOUND',
    payload: { event: 'issue_comment', raw: { comment: { body: 'code' } } },
    updatedAt: new Date(NOW.getTime() - 40 * DAY),
    deadLetteredAt: null,
    payloadPurgedAt: null,
    ...overrides,
  }
}

/** A DB double whose every non-read method throws. */
function readOnlyDb(rows: ReturnType<typeof row>[]) {
  const findMany = jest.fn(
    async (args: { where: { id?: { gt: string } }; take: number }) => {
      const after = args.where.id?.gt
      return rows.filter(r => !after || r.id > after).slice(0, args.take)
    }
  )
  const forbidden = () => {
    throw new Error('write attempted')
  }
  const table = new Proxy(
    { findMany },
    {
      get(target, prop) {
        if (prop === 'findMany') return target.findMany
        return forbidden
      },
    }
  )
  return { db: { prCommentSyncJob: table } as unknown as StockDb, findMany }
}

describe('LUM-913 dead-letter stock tally', () => {
  it('dead letter stock count never writes', async () => {
    const rows = [
      ...Array.from({ length: 1203 }, (_, i) => row(i)),
      row(5000, {
        deadLetteredAt: new Date(NOW.getTime() - 10 * DAY),
        payloadPurgedAt: NOW,
      }),
      row(5001, { deadLetteredAt: new Date(NOW.getTime() - DAY) }),
      row(5002, { direction: 'OUTBOUND', payload: { op: 'CREATE' } }),
    ]
    const { db, findMany } = readOnlyDb(rows)
    const stock = await tallyDeadLetterStock(db, NOW)
    // Paged through the whole table with reads only.
    expect(findMany.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(stock.legacy.rows).toBe(1204)
    expect(stock.legacy.withRawPayload).toBe(1203)
    expect(stock.legacy.byDirection).toEqual({ INBOUND: 1203, OUTBOUND: 1 })
    expect(stock.legacy.byAge['31-90d']).toBe(1204)
    expect(stock.tracked).toEqual({ rows: 2, purged: 1, awaitingPurge: 1 })
    // The tally carries counts only, never a payload.
    expect(JSON.stringify(stock)).not.toContain('code')
  })
})
