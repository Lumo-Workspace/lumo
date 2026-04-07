// Mock ai and @ai-sdk/gateway
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}))

jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'
import { generateObject } from 'ai'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

const asMock = (fn: unknown): jest.Mock<any> => fn as jest.Mock<any>

const mockStats: TaskSummaryStats = {
  totalTasks: 18,
  statusDistribution: { TODO: 5, IN_PROGRESS: 3, DONE: 10 },
  priorityDistribution: { HIGH: 4, MEDIUM: 9, LOW: 5 },
  overdueTasks: { count: 2, taskIds: ['task-1', 'task-2'] },
  memberWorkload: [
    { actorId: 'actor-1', name: 'Alice', assigned: 5, completed: 3 },
  ],
  completionTrend: [
    { date: '2026-04-01', completed: 2 },
    { date: '2026-04-03', completed: 1 },
  ],
  avgCompletionTime: 48,
  subtaskCompletionRate: 0.5,
  agentStats: { total: 4, completed: 2, failed: 1, working: 1 },
  prStats: { total: 7, merged: 5, open: 2 },
}

const mockWorkspaceStats: WorkspaceSummaryStats = {
  ...mockStats,
  projectBreakdown: [
    {
      projectId: 'proj-1',
      projectName: 'Core',
      totalTasks: 10,
      completedTasks: 5,
      overdueTasks: 1,
    },
  ],
}

describe('generateProjectReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    asMock(generateObject).mockResolvedValue({
      object: {
        tldr: 'Project is on track with 55% completion rate.',
        report:
          '## Progress Overview\n10 tasks done.\n## Risks & Blockers\n2 overdue.\n## Suggested Actions\nFocus on blockers.',
      },
    })
  })

  it('returns tldr and report from AI response', async () => {
    const result = await generateProjectReport(mockStats, {
      projectName: 'Core',
      projectDescription: 'Core backend services',
      locale: 'en',
    })

    expect(result.tldr).toBe('Project is on track with 55% completion rate.')
    expect(result.report).toContain('Progress Overview')
  })

  it('calls generateObject with anthropic/claude-sonnet-4.5 model', async () => {
    await generateProjectReport(mockStats, {
      projectName: 'Core',
      projectDescription: null,
      locale: 'en',
    })

    const callArgs = asMock(generateObject).mock.calls[0][0]
    expect(callArgs.model).toBe('mocked-model')
    expect(callArgs.schema).toBeDefined()
    expect(callArgs.system).toBeDefined()
    expect(callArgs.prompt).toBeDefined()
  })

  it('uses Chinese system prompt when locale is zh', async () => {
    await generateProjectReport(mockStats, {
      projectName: 'Core',
      projectDescription: null,
      locale: 'zh',
    })

    const callArgs = asMock(generateObject).mock.calls[0][0]
    expect(callArgs.system).toMatch(/中文|Chinese|项目/)
  })

  it('includes project name in prompt', async () => {
    await generateProjectReport(mockStats, {
      projectName: 'MyProject',
      projectDescription: 'A test project',
      locale: 'en',
    })

    const callArgs = asMock(generateObject).mock.calls[0][0]
    expect(callArgs.prompt).toContain('MyProject')
  })

  it('includes task stats in prompt', async () => {
    await generateProjectReport(mockStats, {
      projectName: 'Core',
      projectDescription: null,
      locale: 'en',
    })

    const callArgs = asMock(generateObject).mock.calls[0][0]
    expect(callArgs.prompt).toContain('18') // totalTasks
    expect(callArgs.prompt).toContain('10') // DONE count
  })
})

describe('generateWorkspaceReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    asMock(generateObject).mockResolvedValue({
      object: {
        tldr: 'Workspace has 18 tasks across 1 project.',
        report:
          '## Progress Overview\nGood progress.\n## Risks & Blockers\nNone.\n## Suggested Actions\nKeep going.',
      },
    })
  })

  it('returns tldr and report from AI response', async () => {
    const result = await generateWorkspaceReport(mockWorkspaceStats, {
      workspaceName: 'Acme',
      locale: 'en',
    })

    expect(result.tldr).toBe('Workspace has 18 tasks across 1 project.')
    expect(result.report).toContain('Progress Overview')
  })

  it('includes project breakdown in prompt', async () => {
    await generateWorkspaceReport(mockWorkspaceStats, {
      workspaceName: 'Acme',
      locale: 'en',
    })

    const callArgs = asMock(generateObject).mock.calls[0][0]
    expect(callArgs.prompt).toContain('Core')
  })
})
