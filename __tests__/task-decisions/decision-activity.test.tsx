/**
 * LUM-1303: decision Activity entries render with the member's name and the
 * decision text (kept on delete, struck through).
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          messages[id] ?? defaultMessage ?? id
        ),
    }),
  }
})
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}))

import { CompactActivityItem } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

const members = [
  { id: 'm1', actorId: 'a1', name: 'Ada', imageUrl: null },
] as unknown as WorkspaceMemberInfo[]

function entry(type: string, payload: Record<string, unknown>) {
  return {
    id: 'e1',
    kind: 'activity' as const,
    type,
    payload,
    actorId: 'a1',
    actor: { id: 'a1', type: 'MEMBER' },
    createdAt: '2026-10-23T09:00:00Z',
  }
}

describe('decision Activity entries', () => {
  it("recorded: member name, 'Decision N' and the text (inline Markdown)", () => {
    render(
      <CompactActivityItem
        entry={entry('DECISION_ADDED', { number: 5, text: 'keep `v1`' })}
        members={members}
        agentActors={[]}
      />
    )
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText(/recorded Decision 5/)).toBeInTheDocument()
    expect(screen.getByText('v1').tagName).toBe('CODE')
  })

  it('edited: shows the new text', () => {
    render(
      <CompactActivityItem
        entry={entry('DECISION_UPDATED', {
          number: 2,
          before: { text: 'old' },
          after: { text: 'new text' },
        })}
        members={members}
        agentActors={[]}
      />
    )
    expect(screen.getByText(/edited Decision 2/)).toBeInTheDocument()
    expect(screen.getByText('new text')).toBeInTheDocument()
    expect(screen.queryByText('old')).toBeNull()
  })

  it('deleted: keeps the text, struck through (an unnumbered entry says "a decision")', () => {
    render(
      <CompactActivityItem
        entry={entry('DECISION_REMOVED', { text: 'gone' })}
        members={members}
        agentActors={[]}
      />
    )
    expect(screen.getByText(/deleted a decision/)).toBeInTheDocument()
    expect(screen.getByText('gone')).toHaveClass('line-through')
  })
})
