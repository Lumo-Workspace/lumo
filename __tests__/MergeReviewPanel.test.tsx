/** @jest-environment jsdom */
/**
 * LUM-541 (P5) — the human near-dup merge review surface. Each proposal shows
 * the canonical row that is KEPT and the near-dup siblings that are MERGED away;
 * Merge calls the confirm action with (canonicalId, supersededIds), Keep
 * dismisses locally (candidacy is derived). The agent/CLI has no confirm path —
 * enforced on the server, not here.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const template = defaultMessage ?? id
      if (!values) return template
      return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_m, key) =>
        values[key] != null ? String(values[key]) : _m
      )
    },
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/memory/content-text', () => ({
  memoryContentToText: (_cat: unknown, content: unknown) =>
    String((content as { fact?: string }).fact ?? ''),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import type { MemoryRow, MergeProposal } from '@/lib/api-client'
import { MergeReviewPanel } from '@/app/workspace/[workspaceUrl]/components/memory/MergeReviewPanel'

function memory(id: string, fact: string): MemoryRow {
  return {
    id,
    scope: 'PROJECT',
    category: 'TRAP',
    agent: 'CLAUDE_CODE',
    content: { fact },
    taskId: null,
    createdByMemberId: null,
    createdAt: '',
    updatedAt: '',
  }
}

function setup(candidates: MergeProposal[], onConfirm = jest.fn()) {
  const ids = candidates.flatMap(c => [c.canonicalId, ...c.supersededIds])
  const memoriesById = new Map(
    ids.map(id => [id, memory(id, `fact for ${id}`)])
  )
  render(
    <MergeReviewPanel
      candidates={candidates}
      memoriesById={memoriesById}
      onConfirm={onConfirm}
      confirming={false}
    />
  )
  return { onConfirm }
}

describe('MergeReviewPanel', () => {
  it('renders nothing when there are no candidates', () => {
    const { container } = render(
      <MergeReviewPanel
        candidates={[]}
        memoriesById={new Map()}
        onConfirm={jest.fn()}
        confirming={false}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the canonical keep row and its superseded siblings, and confirms the merge', () => {
    const { onConfirm } = setup([
      { canonicalId: 'keep', supersededIds: ['dup1', 'dup2'] },
    ])
    // canonical + both siblings are previewed
    expect(screen.getByText('fact for keep')).toBeInTheDocument()
    expect(screen.getByText('fact for dup1')).toBeInTheDocument()
    expect(screen.getByText('fact for dup2')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Merge'))
    expect(onConfirm).toHaveBeenCalledWith('keep', ['dup1', 'dup2'])
  })

  it('Keep dismisses the proposal without confirming', () => {
    const { onConfirm } = setup([
      { canonicalId: 'keep', supersededIds: ['dup1'] },
    ])
    fireEvent.click(screen.getByText('Keep'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByText('fact for keep')).not.toBeInTheDocument()
  })
})
