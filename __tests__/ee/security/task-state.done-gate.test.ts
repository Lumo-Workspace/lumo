/**
 * LUM-1064: plugin half of __tests__/task-state.done-gate.test.ts (split)
 */
import { updateTask } from '@/lib/services/task-state.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

// updateTask's own deps — mocked so the test isolates the DONE gate.
// LUM-732: the DONE gate now consults the PR security scan. Defaults to "no
// linked PR" so the real gate short-circuits before touching the scan
// repository for every test except the dedicated security-gate block below.
// LUM-740: the workspace policy read behind every "blocking" decision;
// null = the 732 default these expectations were written against.
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
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
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
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

    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).rejects.toMatchObject({
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
      updateTask('t-1', 'w-1', { status: 'DONE' }, null, {
        overrideDoneGate: true,
      })
    ).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
    // Overridden → the gate short-circuits before ever consulting the scan
    // repository.
    expect(findSecurityPrs).not.toHaveBeenCalled()
  })
})
