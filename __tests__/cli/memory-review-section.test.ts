/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/session-memory-api', () => ({
  fetchMemoryDraft: jest.fn(),
  applyMemoryReview: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({ promptLine: jest.fn() }))

import { formatMemoryReviewList } from '@/cli/src/lib/memory-content'

describe('formatMemoryReviewList', () => {
  it('numbers rows from 1 with [scope] category and a headline', () => {
    const out = formatMemoryReviewList([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: { trigger: 'worktree 缺软链' }, createdByMemberId: null },
      { id: 'm2', scope: 'TASK', category: 'DECISION', content: { what: '用 dynamic import' }, createdByMemberId: null },
    ])
    const lines = out.split('\n')
    expect(lines[0]).toContain('1.')
    expect(lines[0]).toContain('[TASK]')
    expect(lines[0]).toContain('TRAP')
    expect(lines[0]).toContain('worktree 缺软链')
    expect(lines[1]).toContain('2.')
    expect(lines[1]).toContain('用 dynamic import')
  })

  it('renders (unparseable) when the headline field is missing', () => {
    const out = formatMemoryReviewList([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: {}, createdByMemberId: null },
    ])
    expect(out).toContain('(unparseable)')
  })
})
