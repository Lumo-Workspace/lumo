import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { createTask } from '@/lib/services/task-creation.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'

// LUM-907: rulings always write an audit row now; keep it off the database.
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: jest.fn(async () => true),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    findAllByTask: jest.fn(),
    listExplanationsByCrossingIds: jest.fn(() => []),
    disposition: jest.fn(),
    setRemediationTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listDispositionChangesByTask: jest.fn(),
    // LUM-780: the re-judge trail read — empty here.
    listByTaskAndType: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn(), findHeaderById: jest.fn() },
}))
jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(),
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { addManual: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findManyByIdsForEditChange: jest.fn(),
    findTurnSummariesForSessions: jest.fn(),
    findManyByIdsForAttribution: jest.fn(),
    findTurnUsageForSessions: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findManyForAttribution: jest.fn() },
}))

const findById = boundaryCrossingRepository.findById as jest.Mock
const findAll = boundaryCrossingRepository.findAllByTask as jest.Mock
const disposition = boundaryCrossingRepository.disposition as jest.Mock
const setRemediation =
  boundaryCrossingRepository.setRemediationTask as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listChanges = activityRepository.listDispositionChangesByTask as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const findWithProject = taskRepository.findWithProject as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const create = createTask as jest.Mock
const addManual = taskDependencyService.addManual as jest.Mock
const findAttribEvents =
  hookEventRepository.findManyByIdsForAttribution as jest.Mock
const findTurnUsage = hookEventRepository.findTurnUsageForSessions as jest.Mock
const findTurnSummaries =
  hookEventRepository.findTurnSummariesForSessions as jest.Mock
const findAttribSessions = sessionRepository.findManyForAttribution as jest.Mock

/** LUM-907: the audit context is required on every ruling. */
const TEST_AUDIT = {
  workspaceId: 'ws-1',
  context: {
    actor: { type: 'MEMBER' as const, memberId: 'member-1' },
    source: 'WEB' as const,
  },
}
const ATTRIB = {
  actorMemberId: 'member-1',
  actorClerkId: 'clerk-1',
  audit: TEST_AUDIT,
}

beforeEach(() => {
  jest.clearAllMocks()
  findActor.mockResolvedValue({ id: 'actor-1' })
  disposition.mockResolvedValue({ count: 1 })
  setRemediation.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
  // No re-disposition history by default — listAll surfaces no correction.
  listChanges.mockResolvedValue([])
  // No attribution events / usage by default — a crossing with no linked hook
  // event degrades to unknown attribution (LUM-469).
  findAttribEvents.mockResolvedValue([])
  findTurnUsage.mockResolvedValue([])
  // LUM-590 expanded turn-summary coverage to attrib-event sessions — the
  // agentContext lookup now runs whenever any crossing carries a hook event.
  findTurnSummaries.mockResolvedValue([])
  // No hook-less (CLI-sourced) crossings by default (LUM-511).
  findAttribSessions.mockResolvedValue([])
})

describe('boundaryCrossingService.disposition', () => {
  it('dispositions an open crossing (FALSE_POSITIVE) and writes a human-attributed marker', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'NEW_NPM_DEPENDENCY',
      detail: 'npm install date-fns',
      disposition: null,
    })
    const out = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      'detector lag',
      ATTRIB
    )
    expect(out).toEqual({ crossingId: 'bc-1', disposition: 'FALSE_POSITIVE' })
    expect(disposition).toHaveBeenCalledWith(
      'bc-1',
      'FALSE_POSITIVE',
      'detector lag',
      'actor-1',
      expect.any(Date)
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        actorId: 'actor-1',
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
      })
    )
  })

  it('404s when the crossing is not on the task (no cross-task disposition)', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 'other',
      disposition: null,
    })
    await expect(
      boundaryCrossingService.disposition(
        't-1',
        'bc-1',
        'CONFIRMED',
        null,
        ATTRIB
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(disposition).not.toHaveBeenCalled()
  })

  it('is idempotent: re-dispositioning an already-dispositioned crossing writes no second marker', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push origin main',
      disposition: 'CONFIRMED',
    })
    const out = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'CONFIRMED',
      null,
      ATTRIB
    )
    expect(out).toEqual({ crossingId: 'bc-1', disposition: 'CONFIRMED' })
    expect(disposition).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })
})

describe('boundaryCrossingService.disposition — re-disposition (LUM-450)', () => {
  // A stateful crossing row + append-only activity log: re-disposition mutates
  // the row's CURRENT state while every change is appended to the log, never
  // overwriting an earlier one.
  let row: {
    id: string
    taskId: string
    category: string
    detail: string
    disposition: 'FALSE_POSITIVE' | 'CONFIRMED' | null
    dispositionNote: string | null
    dispositionedAt: Date | null
    dispositionedById: string | null
  }
  let log: Array<{
    taskId: string
    actorId: string | null
    type: string
    payload: Record<string, unknown>
  }>

  beforeEach(() => {
    row = {
      id: 'bc-1',
      taskId: 't-1',
      category: 'TEST_TAMPERING',
      detail: 'edited __tests__/foo.test.ts',
      disposition: null,
      dispositionNote: null,
      dispositionedAt: null,
      dispositionedById: null,
    }
    log = []
    findById.mockImplementation(async (id: string) =>
      id === row.id ? { ...row } : null
    )
    disposition.mockImplementation(
      async (
        _id: string,
        disp: 'FALSE_POSITIVE' | 'CONFIRMED' | null,
        note: string | null,
        actorId: string | null,
        now: Date
      ) => {
        // Mirror the repository: a revert to OPEN (null) resets the row to a
        // pristine open crossing; a disposition stamps reviewer + timestamp.
        row.disposition = disp
        row.dispositionNote = disp === null ? null : note
        row.dispositionedAt = disp === null ? null : now
        row.dispositionedById = disp === null ? null : actorId
        return { count: 1 }
      }
    )
    createActivity.mockImplementation(async (entry: never) => {
      log.push(entry)
      return { id: `act-${log.length}` }
    })
  })

  it('re-dispositioning a crossing updates its current disposition', async () => {
    // Seed: already dispositioned FALSE_POSITIVE by an earlier reviewer.
    row.disposition = 'FALSE_POSITIVE'
    row.dispositionedById = 'actor-0'
    row.dispositionedAt = new Date('2026-06-11T00:00:00.000Z')

    // FALSE_POSITIVE -> CONFIRMED: the latest disposition becomes current.
    const a = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'CONFIRMED',
      'on second look it was real',
      ATTRIB
    )
    expect(a).toEqual({ crossingId: 'bc-1', disposition: 'CONFIRMED' })
    expect(row.disposition).toBe('CONFIRMED')

    // CONFIRMED -> revert to OPEN: the crossing's current state is undispositioned.
    const b = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      null,
      null,
      ATTRIB
    )
    expect(b).toEqual({ crossingId: 'bc-1', disposition: null })
    expect(row.disposition).toBeNull()
    // Reverting fully reopens the row — no stale reviewer/timestamp lingers.
    expect(row.dispositionedById).toBeNull()
    expect(row.dispositionedAt).toBeNull()
  })

  it('re-disposition records an append-only change activity without erasing history', async () => {
    // OPEN -> CONFIRMED -> FALSE_POSITIVE -> OPEN: three real changes.
    await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'CONFIRMED',
      null,
      ATTRIB
    )
    await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      'misjudged',
      ATTRIB
    )
    await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      null,
      'reopening',
      ATTRIB
    )

    // Every change appended its own activity — none erased or overwritten.
    expect(log).toHaveLength(3)
    expect(log.every(e => e.type === 'BOUNDARY_CROSSING_DISPOSITIONED')).toBe(
      true
    )
    // The full from->to trail is recoverable in order from the timeline.
    expect(log.map(e => [e.payload.from, e.payload.to])).toEqual([
      [null, 'CONFIRMED'],
      ['CONFIRMED', 'FALSE_POSITIVE'],
      ['FALSE_POSITIVE', null],
    ])
    // Each entry carries actor + the (optional) note for audit.
    expect(log[1]!.actorId).toBe('actor-1')
    expect(log[1]!.payload.note).toBe('misjudged')
    // The earliest entry is intact after later changes (history not rewritten).
    expect(log[0]!.payload).toMatchObject({
      boundaryCrossingId: 'bc-1',
      from: null,
      to: 'CONFIRMED',
    })
  })

  it('re-dispositioning to the SAME value is a no-op (no write, no redundant audit row)', async () => {
    row.disposition = 'CONFIRMED'
    row.dispositionedById = 'actor-0'
    const out = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'CONFIRMED',
      null,
      ATTRIB
    )
    expect(out).toEqual({ crossingId: 'bc-1', disposition: 'CONFIRMED' })
    expect(disposition).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })
})

describe('boundaryCrossingService.listAll — acceptance read model', () => {
  it('boundary-crossing carries a severity tier exposed by the read model', async () => {
    // Repository returns rows out of severity order (chronological).
    findAll.mockResolvedValue([
      {
        id: 'bc-low',
        category: 'NEW_NPM_DEPENDENCY',
        detail: 'npm install left-pad',
        detectedAt: new Date('2026-06-11T00:00:00.000Z'),
        reversible: true,
        severity: 'LOW',
        disposition: null,
        dispositionNote: null,
        dispositionedAt: null,
        dispositionedById: null,
        remediationTask: null,
      },
      {
        id: 'bc-high',
        category: 'HARDCODED_SECRET',
        detail: 'AWS key in lib/config.ts',
        detectedAt: new Date('2026-06-11T00:01:00.000Z'),
        reversible: false,
        severity: 'HIGH',
        disposition: null,
        dispositionNote: null,
        dispositionedAt: null,
        dispositionedById: null,
        remediationTask: null,
      },
      {
        id: 'bc-medium',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        detail: 'git push origin main',
        detectedAt: new Date('2026-06-11T00:02:00.000Z'),
        reversible: false,
        severity: 'MEDIUM',
        disposition: null,
        dispositionNote: null,
        dispositionedAt: null,
        dispositionedById: null,
        remediationTask: null,
      },
    ])

    const views = await boundaryCrossingService.listAll('t-1')

    // Every crossing carries a severity tier, and the read model exposes it.
    expect(views.map(v => v.severity).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM'])
    expect(views.find(v => v.id === 'bc-high')?.severity).toBe('HIGH')
    // Crossings are ordered/surfaced by severity — most-severe first.
    expect(views.map(v => v.severity)).toEqual(['HIGH', 'MEDIUM', 'LOW'])
    expect(views.map(v => v.id)).toEqual(['bc-high', 'bc-medium', 'bc-low'])
  })

  it('LUM-1059 the read model carries the <TEAM>-X<n> ref, the cuid for an unnumbered row', async () => {
    const row = {
      category: 'TEST_FILE_DELETED',
      detail: 'deleted x.test.ts',
      detectedAt: new Date('2026-06-11T00:00:00.000Z'),
      reversible: true,
      severity: 'MEDIUM',
      disposition: null,
      dispositionNote: null,
      dispositionedAt: null,
      dispositionedById: null,
      remediationTask: null,
      task: { team: { identifier: 'LUM' } },
    }
    findAll.mockResolvedValue([
      { ...row, id: 'cuid-numbered', number: 482 },
      { ...row, id: 'cuid-legacy', number: null },
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    expect(Object.fromEntries(views.map(v => [v.id, v.ref]))).toEqual({
      'cuid-numbered': 'LUM-X482',
      'cuid-legacy': 'cuid-legacy',
    })
  })

  it('crossing surfaces linked remediation task status', async () => {
    findAll.mockResolvedValue([
      {
        id: 'bc-1',
        category: 'MIGRATION_FILE_DELETED',
        detail: 'rm prisma/migrations/0042/migration.sql',
        detectedAt: new Date('2026-06-11T00:00:00.000Z'),
        reversible: false,
        severity: 'MEDIUM',
        disposition: 'CONFIRMED',
        dispositionNote: null,
        dispositionedAt: new Date('2026-06-11T01:00:00.000Z'),
        dispositionedById: 'actor-1',
        remediationTask: {
          number: 441,
          title: 'Restore migration',
          status: 'DONE',
          team: { identifier: 'LUM' },
        },
      },
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    const view = views[0]!
    expect(view.remediationTask).toEqual({
      identifier: 'LUM-441',
      title: 'Restore migration',
      status: 'DONE',
      remediated: true,
    })
  })

  it('dispositioned crossings stay in the acceptance read model', async () => {
    findAll.mockResolvedValue([
      {
        id: 'bc-open',
        category: 'HARDCODED_SECRET',
        detail: 'AWS key in lib/config/aws.ts',
        detectedAt: new Date('2026-06-11T00:00:00.000Z'),
        reversible: false,
        severity: 'HIGH',
        disposition: null,
        dispositionNote: null,
        dispositionedAt: null,
        dispositionedById: null,
        remediationTask: null,
      },
      {
        id: 'bc-confirmed',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        detail: 'git push --force origin main',
        detectedAt: new Date('2026-06-10T00:00:00.000Z'),
        reversible: false,
        severity: 'MEDIUM',
        disposition: 'CONFIRMED',
        dispositionNote: 'owned it',
        dispositionedAt: new Date('2026-06-10T02:00:00.000Z'),
        dispositionedById: 'actor-1',
        remediationTask: null,
      },
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    // The read model returns ALL crossings, not open-only — a CONFIRMED crossing
    // is never removed or hidden after disposition.
    expect(views.map(v => v.id)).toEqual(['bc-open', 'bc-confirmed'])
    const confirmed = views.find(v => v.id === 'bc-confirmed')
    expect(confirmed?.disposition).toBe('CONFIRMED')
  })

  it('surfaces a re-dispositioned crossing as corrected (from -> to, by whom) — LUM-450', async () => {
    findAll.mockResolvedValue([
      {
        id: 'bc-1',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        detail: 'git push origin main',
        detectedAt: new Date('2026-06-10T00:00:00.000Z'),
        reversible: false,
        severity: 'MEDIUM',
        disposition: 'CONFIRMED',
        dispositionNote: null,
        dispositionedAt: new Date('2026-06-11T02:00:00.000Z'),
        dispositionedById: 'actor-2',
        remediationTask: null,
      },
    ])
    // History: first marked FALSE_POSITIVE, then corrected to CONFIRMED.
    listChanges.mockResolvedValue([
      {
        payload: {
          boundaryCrossingId: 'bc-1',
          from: null,
          to: 'FALSE_POSITIVE',
        },
        actorId: 'actor-1',
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
      },
      {
        payload: {
          boundaryCrossingId: 'bc-1',
          from: 'FALSE_POSITIVE',
          to: 'CONFIRMED',
        },
        actorId: 'actor-2',
        createdAt: new Date('2026-06-11T02:00:00.000Z'),
      },
    ])
    const v = (await boundaryCrossingService.listAll('t-1'))[0]!
    expect(v.disposition).toBe('CONFIRMED') // current state = latest
    // The latest *change* is surfaced — not the initial null->FP disposition.
    expect(v.lastDispositionChange).toEqual({
      from: 'FALSE_POSITIVE',
      to: 'CONFIRMED',
      actorId: 'actor-2',
      // LUM-769: a web-panel correction (no channel on the payload) reads WEB.
      channel: 'WEB',
      at: '2026-06-11T02:00:00.000Z',
    })
  })

  it('a crossing dispositioned only once surfaces no correction (first disposition is not a change)', async () => {
    findAll.mockResolvedValue([
      {
        id: 'bc-1',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        detail: 'git push origin main',
        detectedAt: new Date('2026-06-10T00:00:00.000Z'),
        reversible: false,
        severity: 'MEDIUM',
        disposition: 'CONFIRMED',
        dispositionNote: null,
        dispositionedAt: new Date('2026-06-11T00:00:00.000Z'),
        dispositionedById: 'actor-1',
        remediationTask: null,
      },
    ])
    listChanges.mockResolvedValue([
      {
        payload: { boundaryCrossingId: 'bc-1', from: null, to: 'CONFIRMED' },
        actorId: 'actor-1',
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
      },
    ])
    const v = (await boundaryCrossingService.listAll('t-1'))[0]!
    expect(v.lastDispositionChange).toBeNull()
  })
})

describe('boundaryCrossingService.listAll — attribution audit (LUM-469)', () => {
  // A crossing carries the id of the hook event that triggered it; the read
  // model joins that event (+ its session) to surface WHO (member), WHICH
  // agent/session, and WHAT model crossed the boundary. All read-only/additive.
  function crossing(over: Record<string, unknown>) {
    return {
      id: 'bc-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push origin main',
      detectedAt: new Date('2026-06-11T00:00:00.000Z'),
      reversible: false,
      severity: 'MEDIUM',
      disposition: null,
      dispositionNote: null,
      dispositionedAt: null,
      dispositionedById: null,
      remediationTask: null,
      ...over,
    }
  }

  it('crossing read model exposes the agent member and session from its hook event', async () => {
    findAll.mockResolvedValue([crossing({ id: 'bc-1', hookEventId: 'he-1' })])
    // The triggering event carries the owning member + the session it fired in;
    // the session carries the agent type and (when known) its worktree branch.
    findAttribEvents.mockResolvedValue([
      {
        id: 'he-1',
        workspaceMemberId: 'member-7',
        sessionId: 'sess-abc',
        payload: {},
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        session: {
          agent: 'CLAUDE_CODE',
          worktree: { branch: 'lumo/LUM-469-attribution' },
        },
      },
    ])

    const v = (await boundaryCrossingService.listAll('t-1'))[0]!
    expect(v.attribution).toEqual(
      expect.objectContaining({
        workspaceMemberId: 'member-7',
        sessionId: 'sess-abc',
        agent: 'CLAUDE_CODE',
        worktreeBranch: 'lumo/LUM-469-attribution',
      })
    )
    // The id-based fetch was scoped to exactly the crossing's linked event.
    expect(findAttribEvents).toHaveBeenCalledWith(['he-1'])
  })

  it('crossing read model resolves the running model or reports unknown', async () => {
    findAll.mockResolvedValue([
      // (a) model correlated from the turn's usageByModel (LUM-298).
      crossing({ id: 'bc-usage', hookEventId: 'he-usage' }),
      // (b) model carried directly on the hook payload — taken as-is.
      crossing({ id: 'bc-payload', hookEventId: 'he-payload' }),
      // (c) nothing to correlate — reported as unknown, never fabricated.
      crossing({ id: 'bc-unknown', hookEventId: 'he-unknown' }),
    ])
    findAttribEvents.mockResolvedValue([
      {
        id: 'he-usage',
        workspaceMemberId: 'm-1',
        sessionId: 'sess-1',
        payload: {},
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        session: { agent: 'CLAUDE_CODE', worktree: null },
      },
      {
        id: 'he-payload',
        workspaceMemberId: 'm-1',
        sessionId: 'sess-2',
        payload: { model: 'claude-haiku-4-5' },
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        session: { agent: 'CLAUDE_CODE', worktree: null },
      },
      {
        id: 'he-unknown',
        workspaceMemberId: 'm-1',
        sessionId: 'sess-3',
        payload: {},
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        session: { agent: 'CLAUDE_CODE', worktree: null },
      },
    ])
    // The STOP that ended the turn containing the sess-1 edit, with a per-model
    // token map whose dominant model is claude-opus. sess-3 has no usage row.
    findTurnUsage.mockResolvedValue([
      {
        sessionId: 'sess-1',
        createdAt: new Date('2026-06-11T00:05:00.000Z'),
        usageByModel: {
          'claude-opus-4-8': { input: 9000, output: 4000 },
          'claude-haiku-4-5': { input: 100, output: 50 },
        },
      },
    ])

    const views = await boundaryCrossingService.listAll('t-1')
    const byId = new Map(views.map(v => [v.id, v]))
    expect(byId.get('bc-usage')!.attribution.model).toBe('claude-opus-4-8')
    expect(byId.get('bc-payload')!.attribution.model).toBe('claude-haiku-4-5')
    // Undeterminable → null (unknown), never a made-up model.
    expect(byId.get('bc-unknown')!.attribution.model).toBeNull()
  })

  it('attribution is read-only additive and degrades to unknown without erroring', async () => {
    findAll.mockResolvedValue([
      // hookEventId present, but the event row is gone (run reset / cascade).
      crossing({ id: 'bc-vanished', hookEventId: 'he-gone' }),
      // No linked hook event at all.
      crossing({ id: 'bc-no-event', hookEventId: null }),
    ])
    // Event lookup returns nothing — the linked event can't be resolved.
    findAttribEvents.mockResolvedValue([])

    const views = await boundaryCrossingService.listAll('t-1')
    // Degrades to unknown for every dimension — no throw.
    for (const v of views) {
      expect(v.attribution).toEqual({
        workspaceMemberId: null,
        sessionId: null,
        agent: null,
        worktreeBranch: null,
        model: null,
      })
    }
    // Read-only: listing crossings never touches a disposition write path, so
    // the human-only red line (LUM-435/426) is structurally untouched.
    expect(disposition).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('resolves attribution from the originating session for a hook-less crossing (LUM-511)', async () => {
    // A spinoff-laundering crossing is recorded on a `lumo task create` call —
    // no hook event, but it carries the originating sessionId.
    findAll.mockResolvedValue([
      crossing({
        id: 'bc-spinoff',
        category: 'SPINOFF_LAUNDERED',
        hookEventId: null,
        sessionId: 'sess-cli',
      }),
    ])
    findAttribSessions.mockResolvedValue([
      {
        id: 'sess-cli',
        workspaceMemberId: 'member-9',
        agent: 'CLAUDE_CODE',
        worktree: { branch: 'lumo/LUM-511-rework' },
        usageByModel: {
          'claude-opus-4-8': { input: 8000, output: 3000 },
          'claude-haiku-4-5': { input: 50, output: 10 },
        },
      },
    ])

    const v = (await boundaryCrossingService.listAll('t-1'))[0]!
    expect(v.attribution).toEqual({
      workspaceMemberId: 'member-9',
      sessionId: 'sess-cli',
      agent: 'CLAUDE_CODE',
      worktreeBranch: 'lumo/LUM-511-rework',
      // Dominant model from the session's cumulative usageByModel (LUM-298).
      model: 'claude-opus-4-8',
    })
    // The session read was scoped to exactly the hook-less crossing's session,
    // and no hook-event attribution fetch was needed for it.
    expect(findAttribSessions).toHaveBeenCalledWith(['sess-cli'])
  })

  it('hook event wins over session when a crossing somehow carries both (LUM-511)', async () => {
    findAll.mockResolvedValue([
      crossing({ id: 'bc-both', hookEventId: 'he-1', sessionId: 'sess-cli' }),
    ])
    findAttribEvents.mockResolvedValue([
      {
        id: 'he-1',
        workspaceMemberId: 'member-hook',
        sessionId: 'sess-hook',
        payload: {},
        createdAt: new Date('2026-06-11T00:00:00.000Z'),
        session: { agent: 'CLAUDE_CODE', worktree: { branch: 'from-hook' } },
      },
    ])

    const v = (await boundaryCrossingService.listAll('t-1'))[0]!
    expect(v.attribution.workspaceMemberId).toBe('member-hook')
    expect(v.attribution.worktreeBranch).toBe('from-hook')
    // The session fallback isn't consulted when a hook event resolves.
    expect(findAttribSessions).not.toHaveBeenCalled()
  })
})

describe('boundaryCrossingService.spawnRemediation', () => {
  it('spawn remediation task pre-links the crossing and adds the dependency edge', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'MIGRATION_FILE_DELETED',
      detail: 'rm prisma/migrations/0042/migration.sql',
      disposition: 'CONFIRMED',
      remediationTaskId: null,
    })
    findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
    create.mockResolvedValue({
      task: { id: 'remediation-1', number: 441, teamIdentifier: 'LUM' },
    })

    const out = await boundaryCrossingService.spawnRemediation('t-1', 'bc-1', {
      ...ATTRIB,
      workspaceId: 'w-1',
    })

    // A follow-up task is created in the original task's project, with the
    // member who triggered the remediation recorded as its creator (LUM-1283).
    expect(create).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ status: 'TODO' }),
      'actor-1',
      'clerk-1',
      'member-1'
    )
    // The crossing is PRE-LINKED to the new task.
    expect(setRemediation).toHaveBeenCalledWith('bc-1', 'remediation-1')
    // A dependency edge is added: remediation blocked-by the original task.
    expect(addManual).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      blockedTaskId: 'remediation-1',
      blockingTaskId: 't-1',
      kind: 'BLOCKS',
    })
    expect(out).toEqual({
      crossingId: 'bc-1',
      remediationTaskId: 'remediation-1',
      remediationTaskIdentifier: 'LUM-441',
    })
  })

  it('is idempotent: a crossing already linking a remediation task does not create a second', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'MIGRATION_FILE_DELETED',
      detail: 'rm …',
      disposition: 'CONFIRMED',
      remediationTaskId: 'remediation-existing',
    })
    findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
    findHeader.mockResolvedValue({ number: 9, team: { identifier: 'LUM' } })

    const out = await boundaryCrossingService.spawnRemediation('t-1', 'bc-1', {
      ...ATTRIB,
      workspaceId: 'w-1',
    })
    expect(create).not.toHaveBeenCalled()
    expect(addManual).not.toHaveBeenCalled()
    expect(out.remediationTaskId).toBe('remediation-existing')
  })
})
