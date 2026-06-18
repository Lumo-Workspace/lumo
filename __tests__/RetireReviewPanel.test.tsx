/** @jest-environment jsdom */
/**
 * LUM-540 (P4a) — the human retire-review surface. Each candidate shows its
 * reason; Retire calls the confirm action, Keep dismisses it locally (candidacy
 * is derived, so there's no persisted reject). The agent/CLI has no confirm path
 * — enforced on the server, not here.
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
import type { MemoryRow, RetireCandidate } from '@/lib/api-client'
import { RetireReviewPanel } from '@/app/workspace/[workspaceUrl]/components/memory/RetireReviewPanel'

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

function setup(candidates: RetireCandidate[], onConfirm = jest.fn()) {
  const memoriesById = new Map(
    candidates.map(c => [
      c.memoryId,
      memory(c.memoryId, `fact for ${c.memoryId}`),
    ])
  )
  render(
    <RetireReviewPanel
      candidates={candidates}
      memoriesById={memoriesById}
      onConfirm={onConfirm}
      confirming={false}
    />
  )
  return { onConfirm }
}

describe('RetireReviewPanel', () => {
  it('renders nothing when there are no candidates', () => {
    const { container } = render(
      <RetireReviewPanel
        candidates={[]}
        memoriesById={new Map()}
        onConfirm={jest.fn()}
        confirming={false}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each candidate with its reason and retires via the confirm action', () => {
    const { onConfirm } = setup([
      { memoryId: 'low', reasons: ['low-judged-used'] },
    ])
    expect(screen.getByText('fact for low')).toBeInTheDocument()
    expect(screen.getByText('rarely used')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Retire'))
    expect(onConfirm).toHaveBeenCalledWith('low')
  })

  it('Keep dismisses the candidate locally without confirming', () => {
    const { onConfirm } = setup([
      { memoryId: 'wrong', reasons: ['contradiction'] },
    ])
    expect(screen.getByText('contradicts current state')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Keep'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByText('fact for wrong')).not.toBeInTheDocument()
  })
})
