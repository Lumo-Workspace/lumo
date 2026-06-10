/** @jest-environment node */

// Same ESM-avoidance mocks as the sibling task-context suites.
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
  prCommentMirrorRepository: {
    listReviewTodosForPrs: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: { findGithubIdentitiesByIds: jest.fn(async () => []) },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskService } from '@/lib/services/task.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

const mockFindById = taskRepository.findById as jest.Mock
const mockResolve = taskService.resolveIdentifier as jest.Mock
const mockListCriteria = acceptanceCriterionRepository.listByTask as jest.Mock

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
})

describe('buildSessionStartSections — criteria injection (LUM-342)', () => {
  it('renders the contract unwrapped (trusted task framing) when criteria exist', async () => {
    mockListCriteria.mockResolvedValue([CRITERION])
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.criteriaSection).toContain('## 验收标准（合约）')
    expect(out.criteriaSection).toContain(
      '- [MACHINE] all new endpoints have route tests'
    )
    expect(out.criteriaSection).not.toContain('<untrusted')
    // v1 deliberately records no CRITERIA lineage fragment.
    expect(out.fragments).toEqual([])
  })

  it('injects the draft nudge for a still-open task without criteria', async () => {
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.criteriaSection).toContain('该任务尚无验收标准')
  })

  it('skips the nudge for DONE tasks', async () => {
    mockFindById.mockResolvedValue(task({ status: 'DONE' }))
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.criteriaSection).toBe('')
  })
})

describe('buildCriteriaSectionForTask (session attach)', () => {
  it('returns the rendered contract when criteria exist', async () => {
    mockListCriteria.mockResolvedValue([CRITERION])
    const out = await taskContextService.buildCriteriaSectionForTask('tsk_1')
    expect(out).toContain('↳ check: npx jest')
  })

  it('returns the nudge for an open task without criteria, "" for DONE or missing tasks', async () => {
    expect(
      await taskContextService.buildCriteriaSectionForTask('tsk_1')
    ).toContain('该任务尚无验收标准')
    mockFindById.mockResolvedValue(task({ status: 'DONE' }))
    expect(await taskContextService.buildCriteriaSectionForTask('tsk_1')).toBe(
      ''
    )
    mockFindById.mockResolvedValue(null)
    expect(await taskContextService.buildCriteriaSectionForTask('tsk_1')).toBe(
      ''
    )
  })
})

describe('getContextForIdentifier — criteriaSection (LUM-342)', () => {
  it('carries the rendered contract and keeps criteria out of the fragment manifest', async () => {
    mockResolve.mockResolvedValue({ id: 'tsk_1', identifier: 'LUM-1' })
    mockListCriteria.mockResolvedValue([CRITERION])

    const ctx = await taskContextService.getContextForIdentifier(
      'w-1',
      'member-1',
      'LUM-1'
    )

    expect(ctx).not.toBeNull()
    expect(ctx!.criteriaSection).toContain('## 验收标准（合约）')
    expect(ctx!.fragments.map(f => f.type)).not.toContain('CRITERIA')
  })

  it('shows the draft nudge for a still-open task without criteria, nothing for DONE', async () => {
    mockResolve.mockResolvedValue({ id: 'tsk_1', identifier: 'LUM-1' })

    const open = await taskContextService.getContextForIdentifier(
      'w-1',
      'member-1',
      'LUM-1'
    )
    expect(open!.criteriaSection).toContain('该任务尚无验收标准')

    mockFindById.mockResolvedValue(task({ status: 'DONE' }))
    const done = await taskContextService.getContextForIdentifier(
      'w-1',
      'member-1',
      'LUM-1'
    )
    expect(done!.criteriaSection).toBe('')
  })
})
