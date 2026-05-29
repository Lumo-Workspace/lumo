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
// `@/lib/utils/markdown` transitively imports `marked` (ESM), which jest can't
// transform — mock it so the service module loads under jest.
jest.mock('@/lib/utils/markdown', () => ({
  htmlToMarkdown: jest.fn((x: string) => x),
}))

import { renderArtifactSection } from '@/lib/services/task-context.service'

describe('renderArtifactSection', () => {
  it('returns empty string when no artifacts', () => {
    expect(renderArtifactSection([])).toBe('')
  })

  it('renders each artifact as ## [kind] title + content, in array order', () => {
    const md = renderArtifactSection([
      { kind: 'spec', title: 'Spec', content: '## Requirements\n- a' },
      { kind: 'plan', title: 'Implementation plan', content: '1. step one' },
    ])
    expect(md).toContain('## [spec] Spec')
    expect(md).toContain('## Requirements')
    expect(md).toContain('## [plan] Implementation plan')
    expect(md).toContain('1. step one')
    expect(md.indexOf('[spec] Spec')).toBeLessThan(
      md.indexOf('[plan] Implementation plan')
    )
  })

  it('appends the agent label to each heading', () => {
    const out = renderArtifactSection([
      { kind: 'spec', title: 'My Spec', content: 'body', agent: 'CODEX' },
    ])
    expect(out).toContain('## [spec] My Spec · Codex')
    expect(out).toContain('body')
  })
})
