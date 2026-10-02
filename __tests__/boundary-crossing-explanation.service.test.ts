/**
 * @jest-environment node
 *
 * LUM-542 — the append-only agent self-explanation ("申辩") layer. These tests
 * pin the two red lines that make it safe: explanations are insert-only, and
 * they are completely orthogonal to disposition / the DONE gate (an agent can
 * annotate a crossing but never clear it). The whole service→repository stack
 * runs for real against a mocked Prisma client, so the gate's open-crossing
 * query predicate is asserted exactly as it hits the DB.
 */
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

const bc = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
}
const bce = {
  create: jest.fn(),
  findMany: jest.fn(),
  // Intentionally NO update / delete — the layer is insert-only.
}
const session = { findUnique: jest.fn(), findFirst: jest.fn() }

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findUnique: (...a: any[]) => bc.findUnique(...a),
      findMany: (...a: any[]) => bc.findMany(...a),
      update: (...a: any[]) => bc.update(...a),
      updateMany: (...a: any[]) => bc.updateMany(...a),
    },
    boundaryCrossingExplanation: {
      create: (...a: any[]) => bce.create(...a),
      findMany: (...a: any[]) => bce.findMany(...a),
    },
    session: {
      findUnique: (...a: any[]) => session.findUnique(...a),
      findFirst: (...a: any[]) => session.findFirst(...a),
    },
  },
}))

const OPEN_CROSSING = { id: 'bc-1', taskId: 't-1', disposition: null }
const BOUND_SESSION = {
  id: 's-1',
  role: 'WORKER',
  milestone: null,
  task: { id: 't-1', number: 1, title: 'T', team: { identifier: 'LUM' } },
}
const UNATTACHED = { id: 's-1', role: 'WORKER', milestone: null, task: null }
const M = 'member-1'

function explanationRow(note: string) {
  return {
    id: 'ex-1',
    crossingId: 'bc-1',
    note,
    authorSessionId: 's-1',
    memberId: M,
    authorAgent: 'CLAUDE_CODE',
    createdAt: new Date('2026-06-17T00:00:00Z'),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  bc.findUnique.mockResolvedValue(OPEN_CROSSING)
  session.findFirst.mockResolvedValue(BOUND_SESSION)
  bce.create.mockImplementation(async ({ data }: any) =>
    explanationRow(data.note)
  )
})

describe('LUM-542 explanation — append-only explanation', () => {
  it('append-only explanation: each call inserts a fresh row with author attribution and no mutate/delete path', async () => {
    const first = await boundaryCrossingService.explain(
      't-1',
      'bc-1',
      'why I did it',
      { authorSessionId: 's-1', authorAgent: 'CLAUDE_CODE', memberId: M }
    )
    expect(first.explanation.note).toBe('why I did it')
    expect(first.explanation.authorAgent).toBe('CLAUDE_CODE')

    // A second explanation is another INSERT — never an update of the first.
    await boundaryCrossingService.explain('t-1', 'bc-1', 'a correction', {
      authorSessionId: 's-1',
      memberId: M,
    })
    expect(bce.create).toHaveBeenCalledTimes(2)
    // The repository deliberately exposes no update/delete for explanations.
    expect(
      (boundaryCrossingRepository as any).updateExplanation
    ).toBeUndefined()
    expect(
      (boundaryCrossingRepository as any).deleteExplanation
    ).toBeUndefined()
  })

  it('append-only explanation: an untrusted note is sanitized at the read boundary (ANSI/control chars stripped)', async () => {
    const esc = String.fromCharCode(27) // ESC — ANSI escape introducer
    const bel = String.fromCharCode(7) // BEL — a control char
    // A note laced with an ANSI escape sequence and a bell.
    const raw = 'hi' + esc + '[31mRED' + esc + '[0m' + bel + 'bell'
    const out = await boundaryCrossingService.explain('t-1', 'bc-1', raw, {
      authorSessionId: 's-1',
      memberId: M,
    })
    // ESC and BEL stripped; the printable "[31m"/"[0m" bytes survive.
    expect(out.explanation.note).toBe('hi[31mRED[0mbell')
    expect(out.explanation.note).not.toContain(esc)
    expect(out.explanation.note).not.toContain(bel)
    // Stored raw (create receives the raw note); sanitize is a render-only step.
    expect(bce.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ note: raw }),
      })
    )
  })
})

describe('LUM-542 explanation — orthogonal to disposition and DONE gate', () => {
  it('orthogonal to disposition and DONE gate: appending never writes a disposition field, and the gate open-query keys only on disposition:null', async () => {
    await boundaryCrossingService.explain('t-1', 'bc-1', 'note', {
      authorSessionId: 's-1',
      memberId: M,
    })
    // No disposition write path: explain touches neither update nor updateMany
    // on the crossing row, and the create payload carries no disposition field.
    expect(bc.update).not.toHaveBeenCalled()
    expect(bc.updateMany).not.toHaveBeenCalled()
    const createArg = bce.create.mock.calls[0][0]
    expect(Object.keys(createArg.data)).not.toContain('disposition')
    expect(Object.keys(createArg.data)).not.toContain('dispositionedById')
    expect(Object.keys(createArg.data)).not.toContain('dispositionedAt')

    // The DONE gate blocks on findUndispositionedByTask — assert its predicate
    // keys on disposition:null AND advisory:false (advisory crossings are excluded
    // from the gate), so an explained (still-open) non-advisory crossing keeps
    // surfacing to the gate regardless of how many explanations it carries.
    bc.findMany.mockResolvedValue([])
    await boundaryCrossingRepository.findUndispositionedByTask('t-1')
    const where = bc.findMany.mock.calls[0][0].where
    expect(where).toEqual({ taskId: 't-1', disposition: null, advisory: false })
    expect(Object.keys(where)).not.toContain('agentNotifiedAt')
  })
})

describe('LUM-542 explanation — scope guard', () => {
  it('rejects 404 when the crossing is not on the target task (no cross-task reach)', async () => {
    bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, taskId: 'other' })
    await expect(
      boundaryCrossingService.explain('t-1', 'bc-1', 'note', {
        authorSessionId: 's-1',
        memberId: M,
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(bce.create).not.toHaveBeenCalled()
  })

  it('rejects 403 when the session is bound to a different task', async () => {
    session.findFirst.mockResolvedValue({
      ...BOUND_SESSION,
      task: { ...BOUND_SESSION.task, id: 'other' },
    })
    await expect(
      boundaryCrossingService.explain('t-1', 'bc-1', 'note', {
        authorSessionId: 's-1',
        memberId: M,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(bce.create).not.toHaveBeenCalled()
  })

  it('allows a callerless (no session id) write on task/workspace scope alone', async () => {
    const out = await boundaryCrossingService.explain('t-1', 'bc-1', 'note', {})
    expect(out.crossingId).toBe('bc-1')
    expect(session.findFirst).not.toHaveBeenCalled()
    expect(bce.create).toHaveBeenCalled()
  })

  describe('LUM-932 unattached sessions explaining their own work', () => {
    const call = (sid: string) =>
      boundaryCrossingService.explain('t-1', 'bc-1', 'note', {
        authorSessionId: sid,
        memberId: M,
      })
    // findFirst is queried per session id (child row, then parent row).
    const rows = (byId: Record<string, unknown>) =>
      session.findFirst.mockImplementation(
        async ({ where }: any) => byId[where.id] ?? null
      )

    it('allows an unattached root on a crossing it recorded', async () => {
      bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, sessionId: 's-1' })
      rows({ 's-1': UNATTACHED })
      await expect(call('s-1')).resolves.toMatchObject({ crossingId: 'bc-1' })
    })

    it('allows an unattached subagent child on its parent family crossing', async () => {
      bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, sessionId: 's-1' })
      rows({
        's-1:agent-a': { ...UNATTACHED, id: 's-1:agent-a' },
        's-1': UNATTACHED,
      })
      await expect(call('s-1:agent-a')).resolves.toMatchObject({
        crossingId: 'bc-1',
      })
    })

    it('refuses an unattached caller on another family crossing', async () => {
      bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, sessionId: 's-2' })
      rows({ 's-1': UNATTACHED })
      await expect(call('s-1')).rejects.toMatchObject({ status: 403 })
      expect(bce.create).not.toHaveBeenCalled()
    })

    it('refuses an unattached caller when the crossing has no session', async () => {
      bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, sessionId: null })
      rows({ 's-1': UNATTACHED })
      await expect(call('s-1')).rejects.toMatchObject({ status: 403 })
    })

    it('refuses a STEWARD session even on its own family crossing', async () => {
      bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, sessionId: 's-1' })
      rows({ 's-1': { ...UNATTACHED, role: 'STEWARD' } })
      await expect(call('s-1')).rejects.toMatchObject({ status: 403 })
    })

    it('refuses an explicitly bound other-task session on its own crossing', async () => {
      bc.findUnique.mockResolvedValue({ ...OPEN_CROSSING, sessionId: 's-1' })
      rows({
        's-1': { ...BOUND_SESSION, task: { ...BOUND_SESSION.task, id: 'x' } },
      })
      await expect(call('s-1')).rejects.toMatchObject({ status: 403 })
    })

    it('allows a child whose parent is bound to the crossing task', async () => {
      rows({
        's-1:agent-a': { ...UNATTACHED, id: 's-1:agent-a' },
        's-1': BOUND_SESSION,
      })
      await expect(call('s-1:agent-a')).resolves.toMatchObject({
        crossingId: 'bc-1',
      })
    })
  })
})
