/** @jest-environment node */

// LUM-431: the acceptance-criteria *draft nudge* is gated by the per-workspace
// acceptanceMode toggle (default OFF). The contract body itself is never gated
// (always-on data layer). This suite asserts both halves across the three
// injection points: buildSessionStartSections, buildCriteriaSectionForTask, and
// getContextForIdentifier.
//
// Same ESM-avoidance mock wall as the sibling task-context suites.
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findAcceptanceModeByTask: jest.fn(async () => false) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(async () => []),
    findActiveProjectMemories: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findDocumentsForContext: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: { listAllForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listByTask: jest.fn(async () => []),
    listIdAndNumberByTask: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/pr-comment-mirror.repository', () => ({
  prCommentMirrorRepository: { listReviewTodosForPrs: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: { findGithubIdentitiesByIds: jest.fn(async () => []) },
}))
// LUM-497: the reference-class anchor rides on the same gate as the nudge
// itself. Mocked so we can assert buildAnchor is never invoked (not even
// the underlying query) when the workspace has opted out.
jest.mock('@/lib/services/reference-class.service', () => ({
  referenceClassService: { buildAnchor: jest.fn(async () => '') },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskService } from '@/lib/services/task.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { referenceClassService } from '@/lib/services/reference-class.service'

const mockFindById = taskRepository.findById as jest.Mock
const mockResolve = taskService.resolveIdentifier as jest.Mock
const mockListCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const mockAcceptanceMode =
  workspaceRepository.findAcceptanceModeByTask as jest.Mock
const mockBuildAnchor = referenceClassService.buildAnchor as jest.Mock

const NUDGE = 'This task has no acceptance criteria yet'

const CRITERION = {
  id: 'c-1',
  taskId: 'tsk_1',
  statement: 'all new endpoints have route tests',
  verifierType: 'MACHINE',
  checkpointer: 'npx jest',
  evidenceRequired: false,
  source: 'AGENT_DRAFT',
  addedAtRound: 0,
  createdAt: new Date('2026-06-01'),
  updatedAt: new Date('2026-06-01'),
}

function task(over: Record<string, unknown> = {}) {
  return {
    id: 'tsk_1',
    projectId: 'proj_1',
    number: 1,
    team: { identifier: 'LUM' },
    title: 'T',
    status: 'IN_PROGRESS',
    description: null,
    milestoneId: null,
    commentsSummary: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindById.mockResolvedValue(task())
  mockListCriteria.mockResolvedValue([])
  mockResolve.mockResolvedValue({ id: 'tsk_1', identifier: 'LUM-1' })
})

// ── C2: the draft nudge follows the workspace toggle ────────────────────────
describe('acceptance-mode nudge gate', () => {
  it('OFF: suppresses the draft nudge at all three injection points', async () => {
    mockAcceptanceMode.mockResolvedValue(false)

    const start = await taskContextService.buildSessionStartSections('tsk_1')
    expect(start.criteriaSection).toBe('')

    const attach = await taskContextService.buildCriteriaSectionForTask('tsk_1')
    expect(attach).toBe('')

    const ctx = await taskContextService.getContextForIdentifier(
      'w-1',
      'member-1',
      'LUM-1'
    )
    expect(ctx!.criteriaSection).toBe('')
  })

  // LUM-497: an opted-out workspace must pay nothing for the reference-class
  // anchor — not even the query buildAnchor issues internally. The ternary
  // wiring at each call site makes it easy for a future refactor to start
  // evaluating buildAnchor eagerly (e.g. hoisting it out of the conditional),
  // so this pins the "never called when the gate is off" property directly.
  it('OFF: never calls referenceClassService.buildAnchor at any injection point', async () => {
    mockAcceptanceMode.mockResolvedValue(false)

    await taskContextService.buildSessionStartSections('tsk_1')
    await taskContextService.buildCriteriaSectionForTask('tsk_1')
    await taskContextService.getContextForIdentifier('w-1', 'member-1', 'LUM-1')

    expect(mockBuildAnchor).not.toHaveBeenCalled()
  })

  it('ON: emits the draft nudge at all three injection points', async () => {
    mockAcceptanceMode.mockResolvedValue(true)

    const start = await taskContextService.buildSessionStartSections('tsk_1')
    expect(start.criteriaSection).toContain(NUDGE)

    const attach = await taskContextService.buildCriteriaSectionForTask('tsk_1')
    expect(attach).toContain(NUDGE)

    const ctx = await taskContextService.getContextForIdentifier(
      'w-1',
      'member-1',
      'LUM-1'
    )
    expect(ctx!.criteriaSection).toContain(NUDGE)
  })

  // LUM-497: the counterpart to the OFF assertion above — with the gate on
  // and no criteria yet, buildAnchor must actually run at each call site.
  it('ON: calls referenceClassService.buildAnchor at all three injection points', async () => {
    mockAcceptanceMode.mockResolvedValue(true)

    await taskContextService.buildSessionStartSections('tsk_1')
    expect(mockBuildAnchor).toHaveBeenCalledWith('tsk_1')

    mockBuildAnchor.mockClear()
    await taskContextService.buildCriteriaSectionForTask('tsk_1')
    expect(mockBuildAnchor).toHaveBeenCalledWith('tsk_1')

    mockBuildAnchor.mockClear()
    await taskContextService.getContextForIdentifier('w-1', 'member-1', 'LUM-1')
    expect(mockBuildAnchor).toHaveBeenCalledWith('tsk_1')
  })

  it('OFF: a read error on the toggle fails safe to suppressed (never throws)', async () => {
    mockAcceptanceMode.mockRejectedValue(new Error('db down'))

    const start = await taskContextService.buildSessionStartSections('tsk_1')
    expect(start.criteriaSection).toBe('')
    const attach = await taskContextService.buildCriteriaSectionForTask('tsk_1')
    expect(attach).toBe('')
  })
})

// ── C3: the contract body is always-on, never gated by the toggle ───────────
describe('acceptance-mode contract-body always injected', () => {
  it('renders the contract at all three points even with the toggle OFF', async () => {
    mockAcceptanceMode.mockResolvedValue(false) // ritual layer off
    mockListCriteria.mockResolvedValue([CRITERION])

    const start = await taskContextService.buildSessionStartSections('tsk_1')
    expect(start.criteriaSection).toContain('## Acceptance criteria (contract)')
    expect(start.criteriaSection).toContain(
      '- [MACHINE] all new endpoints have route tests'
    )

    const attach = await taskContextService.buildCriteriaSectionForTask('tsk_1')
    expect(attach).toContain('all new endpoints have route tests')

    const ctx = await taskContextService.getContextForIdentifier(
      'w-1',
      'member-1',
      'LUM-1'
    )
    expect(ctx!.criteriaSection).toContain('## Acceptance criteria (contract)')
  })

  it('never consults the acceptance-mode toggle when criteria already exist', async () => {
    mockListCriteria.mockResolvedValue([CRITERION])

    await taskContextService.buildSessionStartSections('tsk_1')
    await taskContextService.buildCriteriaSectionForTask('tsk_1')

    // The toggle gates only the nudge; with a contract present it is irrelevant.
    expect(mockAcceptanceMode).not.toHaveBeenCalled()
  })
})
