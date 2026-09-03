import { updateTask } from '@/lib/services/task-state.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'

// updateTask's own deps — mocked so the test isolates the LUM-422 ④ DONE gate.
// LUM-732: the DONE gate now consults the PR security scan. Defaults to "no
// linked PR" so the real gate short-circuits before touching the scan
// repository for every test except the dedicated security-gate block below.
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
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { latestRunsByCriterion: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
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
// LUM-426 boundary gate runs alongside the send-back gate on DONE — default it
// to "nothing flagged" so these tests keep isolating the LUM-422 ④ gate.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(() => Promise.resolve([])),
    isGateEnabledForWorkspace: jest.fn(() => Promise.resolve(true)),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock
const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const findSecurityPrs =
  pullRequestRepository.findManyForSecurityByTaskId as jest.Mock
const findLatestScans =
  prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_PROGRESS',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
  parentTaskId: null,
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
  latestRuns.mockResolvedValue(new Map())
  listCriteria.mockResolvedValue([
    { id: 'c-1', statement: 'the retry path is covered' },
  ])
  findSecurityPrs.mockResolvedValue([])
  findLatestScans.mockResolvedValue([])
})

const failMap = () =>
  new Map([['c-1', { criterionId: 'c-1', verdict: 'FAIL' }]])
const passMap = () =>
  new Map([['c-1', { criterionId: 'c-1', verdict: 'PASS' }]])

describe('LUM-422 ④ DONE gate', () => {
  it('refuses a DONE transition with 409 while a criterion latest verdict is FAIL', async () => {
    latestRuns.mockResolvedValue(failMap())
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('lists the unresolved criterion statements in the 409 message', async () => {
    latestRuns.mockResolvedValue(failMap())
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toThrow(
      /the retry path is covered/
    )
  })

  it('blocks regardless of the verdict channel (AGENT FAIL is a send-back too)', async () => {
    latestRuns.mockResolvedValue(
      new Map([['c-1', { criterionId: 'c-1', verdict: 'FAIL' }]])
    )
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('lets a human override the gate (overrideDoneGate) past the FAIL', async () => {
    latestRuns.mockResolvedValue(failMap())
    await expect(
      updateTask('t-1', { status: 'DONE' }, null, { overrideDoneGate: true })
    ).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
    // Overridden → it never even needs to look up the verdicts.
    expect(latestRuns).not.toHaveBeenCalled()
  })

  it('transitions freely when the latest verdicts all pass', async () => {
    latestRuns.mockResolvedValue(passMap())
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('never blocks an un-adjudicated criterion (no runs = tacit pass)', async () => {
    latestRuns.mockResolvedValue(new Map())
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
    // No FAIL in the latest map → never fetches criterion statements.
    expect(listCriteria).not.toHaveBeenCalled()
  })

  it('does not run the gate for a non-DONE transition even with a standing FAIL', async () => {
    latestRuns.mockResolvedValue(failMap())
    await update.mockResolvedValue({
      ...TASK,
      status: 'IN_REVIEW',
      team: { identifier: 'LUM' },
      teamId: 'team-1',
    })
    await expect(
      updateTask('t-1', { status: 'IN_REVIEW' })
    ).resolves.toBeDefined()
    expect(latestRuns).not.toHaveBeenCalled()
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
    // repository (mirrors the LUM-422 ④ override behavior above).
    expect(findSecurityPrs).not.toHaveBeenCalled()
  })
})
