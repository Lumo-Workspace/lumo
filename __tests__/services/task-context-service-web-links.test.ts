/** @jest-environment node */
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
  },
}))
jest.mock('@/lib/memory/render', () => ({
  renderMemorySection: jest.fn(() => ''),
  applyTokenBudget: jest.fn((x: unknown[]) => x),
}))

import { renderWebLinkSection } from '@/lib/services/task-context.service'

describe('renderWebLinkSection', () => {
  it('returns empty string when no links', () => {
    expect(renderWebLinkSection([])).toBe('')
  })

  it('renders a link with title + note', () => {
    const md = renderWebLinkSection([
      {
        url: 'https://example.com/article',
        domain: 'example.com',
        title: 'Building distributed systems',
        description: 'A deep dive into consensus.',
        note: 'Cited in design review.',
        fetchedAt: new Date('2026-05-22T10:00:00Z'),
        fetchError: null,
      },
    ])
    expect(md).toContain('## Web Links')
    expect(md).toContain(
      '[Building distributed systems](https://example.com/article)'
    )
    expect(md).toContain('example.com')
    expect(md).toContain('Cited in design review.')
  })

  it('falls back to OG description when no note', () => {
    const md = renderWebLinkSection([
      {
        url: 'https://x/',
        domain: 'x',
        title: 'T',
        description: 'OG says',
        note: null,
        fetchedAt: new Date('2026-05-22T10:00:00Z'),
        fetchError: null,
      },
    ])
    expect(md).toContain('OG says')
  })

  it('falls back to bare URL when no title', () => {
    const md = renderWebLinkSection([
      {
        url: 'https://example.com/long/path',
        domain: 'example.com',
        title: null,
        description: null,
        note: null,
        fetchedAt: null,
        fetchError: 'http 404',
      },
    ])
    expect(md).toContain('https://example.com/long/path')
    expect(md).toContain('(no preview available)')
  })
})
