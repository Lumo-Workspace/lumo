/**
 * @jest-environment node
 *
 * LUM-542 — the one-time agent reminder. A freshly-detected crossing is
 * surfaced to the agent on the next pre-tool-use hook exactly once: the service
 * reads only un-notified OPEN crossings and stamps `agentNotifiedAt`, so a
 * later hook for the same crossing produces nothing. The full repository runs
 * against a mocked Prisma client so the one-time guard is asserted as it hits
 * the DB.
 */
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

const bc = { findMany: jest.fn(), updateMany: jest.fn() }

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: (...a: any[]) => bc.findMany(...a),
      updateMany: (...a: any[]) => bc.updateMany(...a),
    },
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  bc.updateMany.mockResolvedValue({ count: 2 })
})

describe('LUM-542 one-time crossing reminder', () => {
  it('one-time crossing reminder: surfaces fresh OPEN crossings and stamps agentNotifiedAt so a later hook does not re-nag', async () => {
    // First hook after detection: two un-notified OPEN crossings exist.
    bc.findMany.mockResolvedValueOnce([
      { id: 'bc-1', category: 'PUSH_TO_PROTECTED_BRANCH', severity: 'MEDIUM' },
      { id: 'bc-2', category: 'HARDCODED_SECRET', severity: 'HIGH' },
    ])

    const first = await boundaryCrossingService.buildAgentReminder('t-1')
    expect(first).not.toBeNull()
    expect(first).toContain('bc-1')
    expect(first).toContain('bc-2')
    // Points the agent at the explain command, framed as append-only / non-clearing.
    expect(first).toContain('lumo crossing explain')

    // The reminder is fetched only for OPEN, not-yet-notified crossings…
    expect(bc.findMany.mock.calls[0][0].where).toEqual({
      taskId: 't-1',
      disposition: null,
      agentNotifiedAt: null,
    })
    // …and stamping is guarded on agentNotifiedAt:null so it is idempotent.
    expect(bc.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['bc-1', 'bc-2'] }, agentNotifiedAt: null },
      data: { agentNotifiedAt: expect.any(Date) },
    })
  })

  it('one-time crossing reminder: a subsequent hook with nothing un-notified produces no reminder and no write', async () => {
    bc.findMany.mockResolvedValueOnce([])
    const again = await boundaryCrossingService.buildAgentReminder('t-1')
    expect(again).toBeNull()
    expect(bc.updateMany).not.toHaveBeenCalled()
  })
})
