/** @jest-environment node */

// task.service transitively imports @octokit/auth-app (ESM) via
// task-pr-sync.service → lib/integrations/github — mock the whole module to
// keep jest in CJS-land.
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({
      id: 'tsk_1',
      projectId: 'proj_1',
      number: 1,
      team: { identifier: 'LUM' },
    })),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(async () => []),
    findActiveProjectMemories: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn(async () => []) },
}))
// LUM-807: existence check behind the "## Test cases" nudge.
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { hasForTask: jest.fn(async () => false) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listByTask: jest.fn(async () => []),
    // LUM-807: the test-case reminder asks whether the task has any PR.
    listIdAndNumberByTask: jest.fn(async () => []),
  },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { taskSlackContextRepository } from '@/lib/repositories/task-slack-context.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'

describe('buildSessionStartSections (LUM-147)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns empty strings when the task has no memory and no linked resources', async () => {
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out).toMatchObject({ memorySection: '', linkedResourcesSection: '' })
    expect(out.fragments).toEqual([])
  })

  it('renders a PR linked section as a Tier-2 manifest wrapped in the untrusted-linked boundary', async () => {
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValueOnce([
      { number: 7, title: 'Add thing', state: 'OPEN', ciStatus: 'passing' },
    ])
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.linkedResourcesSection).toContain('<untrusted-linked-context>')
    expect(out.linkedResourcesSection).toContain('## Pull Requests')
    // LUM-500: resources are one-line descriptive manifests, not full cards.
    expect(out.linkedResourcesSection).toContain(
      '- [external:github] #7 Add thing → lumo task pr show LUM-1 7'
    )
    // The full-card body (state · CI) no longer appears in session-start.
    expect(out.linkedResourcesSection).not.toContain('OPEN · passing')
    expect(out.memorySection).toBe('')
  })

  it('wraps memory in the untrusted-team-memory boundary', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValueOnce([
      { id: 'm1', category: 'TRAP', content: { trigger: 'X', outcome: 'Y' } },
    ])
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.memorySection).toContain('<untrusted-team-memory>')
    expect(out.memorySection).toContain('## Relevant Memory')
  })

  it('isolates a failing linked fetch — others still render', async () => {
    ;(taskSlackContextRepository.listByTask as jest.Mock).mockRejectedValueOnce(
      new Error('slack down')
    )
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValueOnce([
      { number: 7, title: 'Add thing', state: 'OPEN', ciStatus: 'passing' },
    ])
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.linkedResourcesSection).toContain('## Pull Requests')
    expect(out.linkedResourcesSection).not.toContain('## Slack Context')
  })

  it('returns empty strings when the task does not exist', async () => {
    const { taskRepository } = require('@/lib/repositories/task.repository')
    ;(taskRepository.findById as jest.Mock).mockResolvedValueOnce(null)
    const out = await taskContextService.buildSessionStartSections('nope')
    expect(out).toMatchObject({ memorySection: '', linkedResourcesSection: '' })
    expect(out.fragments).toEqual([])
  })

  it('renders every resource as a Tier-2 manifest line (no budget overflow, no full cards)', async () => {
    // LUM-500: resources no longer compete for the token budget — they all
    // render as one-line manifests regardless of count. 30 PRs → 30 manifest
    // lines, each carrying its retrieval command.
    const prs = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      title: `Refactor module ${i} ` + 'x'.repeat(400),
      state: 'OPEN',
      ciStatus: 'passing',
    }))
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValueOnce(prs)
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.linkedResourcesSection).toContain('## Pull Requests')
    // Manifest lines carry the retrieval command for every PR, first and last.
    expect(out.linkedResourcesSection).toContain('lumo task pr show LUM-1 1')
    expect(out.linkedResourcesSection).toContain('lumo task pr show LUM-1 30')
    // Tier-2: no "manifest only" overflow framing and no full-card body.
    expect(out.linkedResourcesSection).not.toContain('manifest only')
    expect(out.linkedResourcesSection).not.toContain('OPEN · passing')
  })
})
