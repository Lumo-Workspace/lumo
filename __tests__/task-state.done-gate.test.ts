import { updateTask } from '@/lib/services/task-state.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

// updateTask's own deps — mocked so the test isolates the DONE gate.
// LUM-732: the DONE gate now consults the PR security scan. Defaults to "no
// linked PR" so the real gate short-circuits before touching the scan
// repository for every test except the dedicated security-gate block below.
// LUM-740: the workspace policy read behind every "blocking" decision;
// null = the 732 default these expectations were written against.
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn(),
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
// LUM-426 boundary gate — default it to "nothing flagged" so these tests keep
// isolating the plane each block exercises.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(() => Promise.resolve([])),
    isGateEnabledForWorkspace: jest.fn(() => Promise.resolve(true)),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const findSecurityPrs =
  pullRequestRepository.findManyForSecurityByTaskId as jest.Mock
const findLatestScans =
  prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const listTestCases = testCaseRepository.listForTask as jest.Mock
const runsPerCase = testCaseRepository.runsPerCase as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_PROGRESS',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  findSecurityPrs.mockResolvedValue([])
  findLatestScans.mockResolvedValue([])
  listTestCases.mockResolvedValue([])
  runsPerCase.mockResolvedValue(new Map())
})

/**
 * LUM-812 装配：一条用例 + 它最新那条 run。`disposition` 是 run 自己身上的
 * 那一行（null = 还没人裁定）。
 */
function defectRun(over: { disposition?: unknown } = {}) {
  listTestCases.mockResolvedValue([
    {
      id: 'tc-1',
      number: 9,
      title: 'Footer keeps the nav row',
      requiredEnvironment: null,
    },
  ])
  runsPerCase.mockResolvedValue(
    new Map([
      [
        'tc-1',
        [
          {
            id: 'run-9',
            result: 'FAIL',
            environment: 'LOCAL',
            failureAttribution: 'IMPLEMENTATION_DEFECT',
            unprovenVerification: [],
            disposition: over.disposition ?? null,
          },
        ],
      ],
    ])
  )
}

describe('DONE gate — a clean task (LUM-942: no acceptance-criteria plane)', () => {
  it('transitions freely when no plane has a blocker', async () => {
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('does not run the gate for a non-DONE transition', async () => {
    update.mockResolvedValue({
      ...TASK,
      status: 'IN_REVIEW',
      team: { identifier: 'LUM' },
      teamId: 'team-1',
    })
    await expect(
      updateTask('t-1', { status: 'IN_REVIEW' })
    ).resolves.toBeDefined()
    expect(findSecurityPrs).not.toHaveBeenCalled()
  })
})

describe('LUM-732 DONE gate — PR security findings (end-to-end through updateTask)', () => {
  it('refuses DONE with 409 while a linked PR has an undispositioned deterministic HIGH finding', async () => {
    findSecurityPrs.mockResolvedValue([
      { id: 'pr1', number: 1, title: 'x', url: 'u', state: 'open' },
    ])
    findLatestScans.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't-1',
        workspaceId: 'w-1',
        headSha: 'a',
        status: 'FINDINGS',
        trigger: 'PR_EVENT',
        judgeStatus: 'RAN',
        truncated: false,
        detectorVersion: 'v1',
        error: null,
        startedAt: new Date(1000),
        finishedAt: null,
        findings: [
          {
            id: 'f1',
            scanId: 's1',
            kind: 'SECRET',
            ruleId: 'secret:aws-access-key-id',
            severity: 'HIGH',
            provenance: 'DETERMINISTIC',
            filePath: 'src/cfg.ts',
            line: 1,
            title: 't',
            detail: 'd',
            evidence: 'e',
            fingerprint: 'fp',
            externalRef: null,
            disposition: null,
            dispositionNote: null,
            dispositionedById: null,
            dispositionedAt: null,
            inheritedFromFindingId: null,
            createdAt: new Date(0),
          },
        ],
      },
    ])

    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('security finding'),
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('lets a human override the gate (overrideDoneGate) past the open security finding', async () => {
    findSecurityPrs.mockResolvedValue([
      { id: 'pr1', number: 1, title: 'x', url: 'u', state: 'open' },
    ])
    findLatestScans.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        taskId: 't-1',
        workspaceId: 'w-1',
        headSha: 'a',
        status: 'FINDINGS',
        trigger: 'PR_EVENT',
        judgeStatus: 'RAN',
        truncated: false,
        detectorVersion: 'v1',
        error: null,
        startedAt: new Date(1000),
        finishedAt: null,
        findings: [
          {
            id: 'f1',
            scanId: 's1',
            kind: 'SECRET',
            ruleId: 'secret:aws-access-key-id',
            severity: 'HIGH',
            provenance: 'DETERMINISTIC',
            filePath: 'src/cfg.ts',
            line: 1,
            title: 't',
            detail: 'd',
            evidence: 'e',
            fingerprint: 'fp',
            externalRef: null,
            disposition: null,
            dispositionNote: null,
            dispositionedById: null,
            dispositionedAt: null,
            inheritedFromFindingId: null,
            createdAt: new Date(0),
          },
        ],
      },
    ])

    await expect(
      updateTask('t-1', { status: 'DONE' }, null, { overrideDoneGate: true })
    ).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
    // Overridden → the gate short-circuits before ever consulting the scan
    // repository.
    expect(findSecurityPrs).not.toHaveBeenCalled()
  })
})

describe('LUM-812 DONE gate — a proven test-case defect (end-to-end through updateTask)', () => {
  it('a proven defect run blocks the DONE transition and names the case', async () => {
    defectRun()

    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()

    // 文案得点名是哪条用例，否则读的人还得自己去翻 run 历史。
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toThrow(
      /TC9 "Footer keeps the nav row"/
    )
    // 并且说清楚清闸的办法是人裁定一次，不是「先把 bug 修好」。
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toThrow(
      /Fixing the defect first is not required/
    )
  })

  it('lets the transition through once a human has dispositioned that run', async () => {
    defectRun({
      disposition: {
        id: 'd-1',
        disposition: 'KNOWN_DEFECT',
        note: 'shipping with it, tracked in LUM-900',
        dispositionedById: 'm-1',
        dispositionedAt: new Date(),
        channel: 'WEB',
      },
    })

    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
  })

  it('does not block on a FAIL that was attributed to anything other than the implementation', async () => {
    listTestCases.mockResolvedValue([
      { id: 'tc-1', number: 4, title: 'Stale copy', requiredEnvironment: null },
    ])
    runsPerCase.mockResolvedValue(
      new Map([
        [
          'tc-1',
          [
            {
              id: 'run-4',
              result: 'FAIL',
              environment: 'LOCAL',
              failureAttribution: 'CASE_OUTDATED',
              unprovenVerification: [],
              disposition: null,
            },
          ],
        ],
      ])
    )

    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
  })
})
