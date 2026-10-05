import { updateTask } from '@/lib/services/task-state.service'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

// updateTask's own deps — mocked so the test isolates the LUM-426 DONE gate.
// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn(() => []),
    syncTaskTags: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
// LUM-812: the DONE gate now consults the test-case plane fail-closed (a proven,
// undispositioned defect blocks). Default it to "no test cases" so these tests
// keep isolating the gate they were written for.
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(() => Promise.resolve([])),
    runsPerCase: jest.fn(() => Promise.resolve(new Map())),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
    findUndispositionedByTask: jest.fn(),
    isGateEnabledForWorkspace: jest.fn(),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const findOpen =
  boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
const gateEnabled =
  boundaryCrossingRepository.isGateEnabledForWorkspace as jest.Mock
const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_REVIEW',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
}

const openCrossing = () => [
  {
    id: 'bc-1',
    taskId: 't-1',
    category: 'PUSH_TO_PROTECTED_BRANCH',
    detail: 'git push origin main',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  // No unresolved send-back — isolate the boundary gate from the LUM-422 gate.
  findOpen.mockResolvedValue([])
  gateEnabled.mockResolvedValue(true)
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('LUM-426 DONE gate — assertNoUnacknowledgedBoundaryCrossings', () => {
  it('unacknowledged boundary-crossing blocks DONE with 409', async () => {
    findOpen.mockResolvedValue(openCrossing())
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()
    // Only the workspace it belongs to is consulted for the toggle.
    expect(gateEnabled).toHaveBeenCalledWith('w-1')
  })

  it('acknowledging a boundary-crossing clears the DONE block', async () => {
    // While unacknowledged → blocked.
    findOpen.mockResolvedValue(openCrossing())
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).rejects.toMatchObject({
      status: 409,
    })

    // After a human acknowledges it, there are no open crossings → DONE flows.
    findOpen.mockResolvedValue([])
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      'w-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('gate setting defaults on and opting out keeps flagging but drops the DONE block', async () => {
    // FLAGGING HALF (always on): the detector records a crossing without ever
    // consulting the gate toggle — recording is unconditional by construction.
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: { tool_input: { command: 'git push origin main' } },
    })
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BOUNDARY_CROSSING_DETECTED' })
    )
    expect(gateEnabled).not.toHaveBeenCalled() // detector never reads the toggle

    // DEFAULT ON: with the toggle at its default (true) an open crossing blocks.
    findOpen.mockResolvedValue(openCrossing())
    gateEnabled.mockResolvedValue(true)
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).rejects.toMatchObject({
      status: 409,
    })

    // OPT OUT: turn the toggle off → the same open crossing no longer blocks DONE.
    gateEnabled.mockResolvedValue(false)
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      'w-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('a HIGH-severity open crossing forces the gate even when the workspace opted out (LUM-442)', async () => {
    findOpen.mockResolvedValue([
      {
        id: 'bc-high',
        taskId: 't-1',
        category: 'HARDCODED_SECRET',
        detail: 'AWS key leaked',
        severity: 'HIGH',
      },
    ])
    // Opted OUT — yet a HIGH crossing still blocks (the opt-out is a noise
    // escape hatch, not a licence to ship the most dangerous actions unreviewed).
    gateEnabled.mockResolvedValue(false)
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).rejects.toMatchObject({
      status: 409,
    })

    // Still clearable by a human — once dispositioned there are no open
    // crossings, and DONE flows (it's "a human must look", not a hard wall).
    findOpen.mockResolvedValue([])
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()
  })

  it('a MEDIUM/LOW open crossing still honours the opt-out (LUM-442)', async () => {
    findOpen.mockResolvedValue([
      {
        id: 'bc-med',
        taskId: 't-1',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        detail: 'git push origin main',
        severity: 'MEDIUM',
      },
    ])
    gateEnabled.mockResolvedValue(false)
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()
  })

  it('short-circuits free when there are no open crossings (never reads the toggle)', async () => {
    findOpen.mockResolvedValue([])
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()
    expect(gateEnabled).not.toHaveBeenCalled()
  })

  it('a human override (overrideDoneGate) sails past an open crossing', async () => {
    findOpen.mockResolvedValue(openCrossing())
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' }, null, {
        overrideDoneGate: true,
      })
    ).resolves.toBeDefined()
    expect(findOpen).not.toHaveBeenCalled()
  })

  it('does not run the boundary gate for a non-DONE transition', async () => {
    findOpen.mockResolvedValue(openCrossing())
    update.mockResolvedValue({
      ...TASK,
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
      teamId: 'team-1',
    })
    await expect(
      updateTask('t-1', 'w-1', { status: 'IN_PROGRESS' })
    ).resolves.toBeDefined()
    expect(findOpen).not.toHaveBeenCalled()
  })

  // LUM-454: the 409 must be human-readable, not the wall of red from LUM-445.
  // A TEST_TAMPERING detail embeds the full criterion statement; before this
  // fix, N same-category crossings spliced that long text in N times. The
  // compact message states the count + per-category counts and embeds NO
  // per-crossing detail — so CLI/API consumers get a sane string too.
  it('DONE-gate block message is compact and does not repeat the full crossing detail per crossing', async () => {
    const longDetail =
      'edited __tests__/payments.test.ts which the MACHINE checkpointer ' +
      '"the checkout API returns 200 for a valid card and 422 for an expired ' +
      'one, and never double-charges on a retried request" depends on — ' +
      'reward-hacking suspect, a human must confirm the code was actually fixed'
    findOpen.mockResolvedValue([
      {
        id: 'bc-1',
        taskId: 't-1',
        category: 'TEST_TAMPERING',
        detail: longDetail,
        severity: 'MEDIUM',
      },
      {
        id: 'bc-2',
        taskId: 't-1',
        category: 'TEST_TAMPERING',
        detail: longDetail,
        severity: 'MEDIUM',
      },
      {
        id: 'bc-3',
        taskId: 't-1',
        category: 'TEST_TAMPERING',
        detail: longDetail,
        severity: 'MEDIUM',
      },
    ])

    const err = await updateTask('t-1', 'w-1', { status: 'DONE' }).catch(e => e)
    expect(err.status).toBe(409)
    const msg = err.message as string

    // The count is stated…
    expect(msg).toContain('3')
    // …and the category is named ONCE with its count, not three separate lines.
    expect(msg).toContain('TEST_TAMPERING')
    expect(msg.split('TEST_TAMPERING').length - 1).toBe(1)
    // The full per-crossing detail is NOT spliced into the message at all
    // (let alone three times) — that's what made it a wall of red.
    expect(msg).not.toContain(longDetail)
    // Compactness guard: three copies of the detail (~3 × 230 chars) plus
    // boilerplate would blow well past this; the compact form stays small.
    expect(msg.length).toBeLessThan(400)
  })

  it('DONE-gate block message names each distinct category with its count', async () => {
    findOpen.mockResolvedValue([
      {
        id: 'a',
        taskId: 't-1',
        category: 'TEST_TAMPERING',
        detail: 'edited a test',
        severity: 'MEDIUM',
      },
      {
        id: 'b',
        taskId: 't-1',
        category: 'TEST_TAMPERING',
        detail: 'edited another test',
        severity: 'MEDIUM',
      },
      {
        id: 'c',
        taskId: 't-1',
        category: 'HARDCODED_SECRET',
        detail: 'AWS key',
        severity: 'HIGH',
      },
    ])

    const err = await updateTask('t-1', 'w-1', { status: 'DONE' }).catch(e => e)
    expect(err.status).toBe(409)
    const msg = err.message as string
    // Both distinct categories are named, each with its own count, total = 3.
    expect(msg).toContain('3')
    expect(msg).toContain('2 TEST_TAMPERING')
    expect(msg).toContain('1 HARDCODED_SECRET')
  })

  // LUM-491: SESSION_BINDING_MISSING is a new MEDIUM-severity category — the
  // gate is category-agnostic, so it should participate automatically.
  describe('LUM-491 SESSION_BINDING_MISSING participates in the DONE gate', () => {
    it('an open SESSION_BINDING_MISSING crossing blocks DONE with 409 while the gate is enabled', async () => {
      findOpen.mockResolvedValue([
        {
          id: 'bc-sbm-1',
          taskId: 't-1',
          category: 'SESSION_BINDING_MISSING',
          detail: 'agent ran without a bound task session',
          severity: 'MEDIUM',
          disposition: null,
        },
      ])
      gateEnabled.mockResolvedValue(true)

      await expect(
        updateTask('t-1', 'w-1', { status: 'DONE' })
      ).rejects.toMatchObject({
        status: 409,
      })
      expect(update).not.toHaveBeenCalled()
    })

    it('an open SESSION_BINDING_MISSING crossing allows DONE once cleared', async () => {
      // Undispositioned → blocked.
      findOpen.mockResolvedValue([
        {
          id: 'bc-sbm-2',
          taskId: 't-1',
          category: 'SESSION_BINDING_MISSING',
          detail: 'agent ran without a bound task session',
          severity: 'MEDIUM',
          disposition: null,
        },
      ])
      gateEnabled.mockResolvedValue(true)
      await expect(
        updateTask('t-1', 'w-1', { status: 'DONE' })
      ).rejects.toMatchObject({
        status: 409,
      })

      // After a human disposes the crossing → no open crossings → DONE flows.
      findOpen.mockResolvedValue([])
      await expect(
        updateTask('t-1', 'w-1', { status: 'DONE' })
      ).resolves.toBeDefined()
      expect(update).toHaveBeenCalledWith(
        't-1',
        'w-1',
        expect.objectContaining({ status: 'DONE' })
      )
    })

    it('SESSION_BINDING_MISSING (MEDIUM) respects the opt-out toggle, unlike HIGH', async () => {
      findOpen.mockResolvedValue([
        {
          id: 'bc-sbm-3',
          taskId: 't-1',
          category: 'SESSION_BINDING_MISSING',
          detail: 'agent ran without a bound task session',
          severity: 'MEDIUM',
          disposition: null,
        },
      ])
      // Gate disabled → MEDIUM crossing no longer blocks DONE.
      gateEnabled.mockResolvedValue(false)
      await expect(
        updateTask('t-1', 'w-1', { status: 'DONE' })
      ).resolves.toBeDefined()
    })
  })
})
