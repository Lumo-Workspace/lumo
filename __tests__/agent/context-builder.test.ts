// Mock Prisma before imports
const mockFindUniqueOrThrow = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUniqueOrThrow: (...args: unknown[]) => mockFindUniqueOrThrow(...args),
    },
  },
}))

// Mock marked (ESM issue)
jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))

import { buildAgentContext } from '@/lib/agent/context-builder'

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeTaskContext(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Add login page',
    description: 'Build a login page with email/password',
    spec: '## Requirements\n- Email field\n- Password field\n- Submit button',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    comments: [],
    clarifies: [],
    agentRuns: [],
    pullRequests: [],
    project: { name: 'Lumo', description: null },
    parent: null,
    children: [],
    ...overrides,
  }
}

const BASE_OPTIONS = {
  taskId: 'task-1',
  branchName: 'lumo/LUM-42-add-login-page',
  identifier: 'LUM-42',
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildAgentContext', () => {
  beforeEach(() => {
    mockFindUniqueOrThrow.mockReset()
  })

  it('includes task core and instructions for a minimal task', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(makeTaskContext())

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('# Task: Add login page')
    expect(result).toContain('Priority: HIGH')
    expect(result).toContain('## Spec')
    expect(result).toContain('## Description')
    expect(result).toContain('## Instructions')
    expect(result).toContain('lumo/LUM-42-add-login-page')
    expect(result).toContain('[LUM-42]')
    expect(result).toContain('mcp__lumo-sandbox__ask_user')
  })

  it('includes comments section when comments exist', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        comments: [
          {
            id: 'c1',
            body: 'Please also add forgot password link',
            type: 'USER',
            createdAt: new Date('2026-04-01'),
            author: { type: 'HUMAN' },
          },
          {
            id: 'c2',
            body: 'Got it, will add the link',
            type: 'AGENT',
            createdAt: new Date('2026-04-01'),
            author: { type: 'AGENT' },
          },
        ],
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('## Comments')
    expect(result).toContain('**Team member**')
    expect(result).toContain('**Agent**')
    expect(result).toContain('forgot password link')
  })

  it('truncates long comments to 500 chars', async () => {
    const longBody = 'x'.repeat(600)
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        comments: [
          {
            id: 'c1',
            body: longBody,
            type: 'USER',
            createdAt: new Date('2026-04-01'),
            author: { type: 'HUMAN' },
          },
        ],
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    // Should be truncated — no 600-char run of 'x'
    expect(result).not.toContain(longBody)
    expect(result).toContain('...')
  })

  it('includes clarifications section with resolved Q&A', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        clarifies: [
          {
            question: 'Should the form use OAuth or email/password?',
            context: 'The spec mentions both',
            reply: 'Use email/password only',
            createdAt: new Date('2026-04-01'),
          },
          {
            question: 'Unresolved question?',
            context: null,
            reply: null, // not resolved — should be filtered out
            createdAt: new Date('2026-04-02'),
          },
        ],
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('## Clarifications')
    expect(result).toContain('Should the form use OAuth')
    expect(result).toContain('Use email/password only')
    // Unresolved question should NOT appear
    expect(result).not.toContain('Unresolved question')
  })

  it('includes agent run history, skipping the latest (current) run', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        agentRuns: [
          {
            runNumber: 3,
            status: 'WORKING',
            trigger: 'retry',
            summary: null,
            errorMessage: null,
            branchName: 'lumo/LUM-42',
            prUrl: null,
            durationMs: null,
            startedAt: new Date(),
            finishedAt: null,
          },
          {
            runNumber: 2,
            status: 'FAILED',
            trigger: 'comment',
            summary: 'Attempted to add login form',
            errorMessage: 'Sandbox timeout',
            branchName: 'lumo/LUM-42',
            prUrl: null,
            durationMs: 120000,
            startedAt: new Date('2026-04-01'),
            finishedAt: new Date('2026-04-01'),
          },
          {
            runNumber: 1,
            status: 'COMPLETED',
            trigger: 'initial',
            summary: 'Created initial login page',
            errorMessage: null,
            branchName: 'lumo/LUM-42',
            prUrl: 'https://github.com/org/repo/pull/10',
            durationMs: 60000,
            startedAt: new Date('2026-03-31'),
            finishedAt: new Date('2026-03-31'),
          },
        ],
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('## Past Agent Runs')
    // Run #3 (current) should NOT appear in history
    expect(result).not.toContain('Run #3')
    // Run #2 and #1 should appear
    expect(result).toContain('Run #2')
    expect(result).toContain('Run #1')
    expect(result).toContain('Sandbox timeout')
    expect(result).toContain('https://github.com/org/repo/pull/10')
  })

  it('includes PR feedback section', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        pullRequests: [
          {
            number: 10,
            url: 'https://github.com/org/repo/pull/10',
            state: 'open',
            ciStatus: 'failure',
            title: 'feat: add login page',
          },
        ],
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('## Pull Requests')
    expect(result).toContain('PR #10')
    expect(result).toContain('CI: failure')
  })

  it('includes project context when description exists', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        project: {
          name: 'Lumo',
          description: 'AI-native project management tool',
        },
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('## Project Context')
    expect(result).toContain('Project: Lumo')
    expect(result).toContain('AI-native project management tool')
  })

  it('skips project context when no description', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        project: { name: 'Lumo', description: null },
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).not.toContain('## Project Context')
  })

  it('includes related tasks (siblings + children)', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        parent: {
          title: 'Auth epic',
          children: [
            { id: 'task-1', title: 'Add login page', status: 'IN_PROGRESS' },
            { id: 'task-2', title: 'Add signup page', status: 'TODO' },
            { id: 'task-3', title: 'Add OAuth', status: 'DONE' },
          ],
        },
        children: [
          { id: 'task-4', title: 'Login form component', status: 'TODO' },
        ],
      })
    )

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).toContain('## Related Tasks')
    expect(result).toContain('Parent: Auth epic')
    // Siblings (excluding self)
    expect(result).toContain('Add signup page')
    expect(result).toContain('Add OAuth')
    // Self should NOT appear as sibling
    expect(result).not.toMatch(/\[IN_PROGRESS\] Add login page/)
    // Children
    expect(result).toContain('Login form component')
  })

  it('respects token budget by dropping sections that exceed it', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(
      makeTaskContext({
        spec: 'Simple spec',
        comments: [
          {
            id: 'c1',
            body: 'z'.repeat(2000), // ~500 tokens for comment section
            type: 'USER',
            createdAt: new Date('2026-04-01'),
            author: { type: 'HUMAN' },
          },
        ],
        project: {
          name: 'Lumo',
          description: 'y'.repeat(2000), // ~500 tokens for project section (truncated to 500 chars)
        },
      })
    )

    // Large budget — everything fits
    const large = await buildAgentContext({
      ...BASE_OPTIONS,
      tokenBudget: 8000,
    })
    expect(large).toContain('## Comments')
    expect(large).toContain('## Project Context')

    // Tiny budget — only the smallest P0 sections fit
    const tiny = await buildAgentContext({ ...BASE_OPTIONS, tokenBudget: 200 })
    // Instructions (~150 tokens) fits, but task core with spec doesn't if combined
    // At minimum, some sections must be dropped
    const sectionCount = [
      '## Comments',
      '## Project Context',
      '## Instructions',
      '## Spec',
    ].filter(s => tiny.includes(s)).length
    // With 200 tokens, not all 4 sections can fit
    expect(sectionCount).toBeLessThan(4)
  })

  it('omits empty optional sections', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(makeTaskContext())

    const result = await buildAgentContext(BASE_OPTIONS)

    expect(result).not.toContain('## Comments')
    expect(result).not.toContain('## Clarifications')
    expect(result).not.toContain('## Past Agent Runs')
    expect(result).not.toContain('## Pull Requests')
    expect(result).not.toContain('## Project Context')
    expect(result).not.toContain('## Related Tasks')
  })
})
