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

// LUM-897 — advisory crossings never block DONE, so the reminder must not read
// like one that does: advisory rows are labelled non-blocking and get no
// explain/disposition guidance; a mixed batch splits into two labelled groups.
describe('LUM-897 advisory-aware crossing reminder', () => {
  const blocking = {
    id: 'bc-block',
    category: 'HARDCODED_SECRET',
    severity: 'HIGH',
    advisory: false,
  }
  const advisory = {
    id: 'bc-adv',
    category: 'HARDCODED_SECRET',
    severity: 'MEDIUM',
    advisory: true,
  }

  it('reminder selects the advisory flag so it can tell blocking from advisory', async () => {
    bc.findMany.mockResolvedValueOnce([advisory])
    await boundaryCrossingService.buildAgentReminder('t-1')
    expect(bc.findMany.mock.calls[0][0].select).toMatchObject({
      advisory: true,
    })
  })

  it('advisory-only batch is labelled non-blocking with no disposition guidance', async () => {
    bc.findMany.mockResolvedValueOnce([advisory])
    const text = await boundaryCrossingService.buildAgentReminder('t-1')
    expect(text).not.toBeNull()
    expect(text).toContain('bc-adv')
    expect(text).toMatch(/advisory/i)
    expect(text).toContain('does NOT block DONE')
    expect(text).not.toContain('lumo crossing explain')
    expect(text).not.toContain('a human dispositions')
    expect(text).not.toMatch(/^⚠/)
    // Still one-time: advisory rows are stamped like any other.
    expect(bc.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['bc-adv'] }, agentNotifiedAt: null },
      data: { agentNotifiedAt: expect.any(Date) },
    })
  })

  it('blocking-only batch keeps the existing explain and disposition guidance', async () => {
    bc.findMany.mockResolvedValueOnce([blocking])
    const text = await boundaryCrossingService.buildAgentReminder('t-1')
    expect(text).toContain(
      '⚠ Lumo recorded 1 new boundary crossing from your recent actions:'
    )
    expect(text).toContain('  • [HIGH] HARDCODED_SECRET (bc-block)')
    expect(text).toContain('lumo crossing explain <id> --note')
    expect(text).toContain('a human dispositions that')
    expect(text).not.toMatch(/advisory/i)
  })

  it('mixed batch separates blocking and advisory crossings into labelled groups', async () => {
    bc.findMany.mockResolvedValueOnce([advisory, blocking])
    const text = (await boundaryCrossingService.buildAgentReminder('t-1'))!
    const lines = text.split('\n')
    const blockHead = lines.findIndex(l => /blocks DONE/.test(l))
    const advHead = lines.findIndex(l => /does NOT block DONE/.test(l))
    expect(blockHead).toBeGreaterThanOrEqual(0)
    expect(advHead).toBeGreaterThan(blockHead)
    // Each id sits under exactly one group.
    const idLine = (id: string) => lines.findIndex(l => l.includes(`(${id})`))
    expect(lines.filter(l => l.includes('(bc-block)'))).toHaveLength(1)
    expect(lines.filter(l => l.includes('(bc-adv)'))).toHaveLength(1)
    expect(idLine('bc-block')).toBeGreaterThan(blockHead)
    expect(idLine('bc-block')).toBeLessThan(advHead)
    expect(idLine('bc-adv')).toBeGreaterThan(advHead)
    // The explain guidance is scoped to the blocking group.
    const guidance = lines.find(l => l.includes('lumo crossing explain'))!
    expect(guidance).toMatch(/blocking/)
  })
})
