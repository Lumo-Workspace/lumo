import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { createTask } from '@/lib/services/task-creation.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    findAllByTask: jest.fn(),
    disposition: jest.fn(),
    setRemediationTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listDispositionChangesByTask: jest.fn(),
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

const ATTRIB = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

beforeEach(() => {
  jest.clearAllMocks()
  findActor.mockResolvedValue({ id: 'actor-1' })
  disposition.mockResolvedValue({ count: 1 })
  setRemediation.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
  // No re-disposition history by default — listAll surfaces no correction.
  listChanges.mockResolvedValue([])
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

    // A follow-up task is created in the original task's project.
    expect(create).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ status: 'TODO' }),
      'actor-1',
      'clerk-1'
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
