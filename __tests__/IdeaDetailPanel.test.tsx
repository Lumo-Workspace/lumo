/** @jest-environment jsdom */

// react-intl → id-as-message, appending interpolated values so templated
// strings (source context, initiative name) are assertable.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${Object.values(values).join(' ')}` : id),
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IdeaDetailPanel } from '@/app/workspace/[workspaceUrl]/components/IdeaDetailPanel'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

// jsdom lacks ResizeObserver, which some Radix internals reference defensively.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

const fullyLineaged: ApiIdea = {
  id: 'i1',
  number: 4,
  identifier: 'LUM-I4',
  statement: 'ship the idea detail slide-over',
  status: 'PLANNED',
  sourceContext: 'from the standup',
  sourceSessionId: 'sess-1',
  sourceTaskId: 'LUM-9',
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: 'run-1',
  initiative: { id: 'init-1', number: 5, name: 'Idea visibility' },
}

const bare: ApiIdea = {
  ...fullyLineaged,
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  planRunId: null,
  initiative: null,
}

describe('IdeaDetailPanel', () => {
  it('renders statement, identifier, status badge and lineage', () => {
    render(
      <IdeaDetailPanel
        idea={fullyLineaged}
        workspaceUrl='lumo'
        onSave={jest.fn()}
      />
    )

    // statement + identifier + status badge
    expect(
      screen.getByText('ship the idea detail slide-over')
    ).toBeInTheDocument()
    expect(screen.getByText('LUM-I4')).toBeInTheDocument()
    expect(screen.getByText('ideas.statusPlanned')).toBeInTheDocument()

    // lineage: source context / task / session
    expect(
      screen.getByText('ideas.detail.sourceContext from the standup')
    ).toBeInTheDocument()
    expect(screen.getByText('ideas.fromTask LUM-9')).toBeInTheDocument()
    expect(
      screen.getByText('ideas.detail.sourceSession sess-1')
    ).toBeInTheDocument()

    // lineage: consumed-by run links to the plan run
    const runLink = screen.getByText('ideas.detail.consumedByRun').closest('a')
    expect(runLink).toHaveAttribute('href', '/workspace/lumo/plan/run-1')

    // lineage: materialised-into links to the Initiative detail
    const initLink = screen
      .getByText('ideas.plannedInto Idea visibility')
      .closest('a')
    expect(initLink).toHaveAttribute(
      'href',
      '/workspace/lumo/initiatives/init-1'
    )
  })

  it('shows the no-lineage fallback for a bare captured idea', () => {
    render(
      <IdeaDetailPanel idea={bare} workspaceUrl='lumo' onSave={jest.fn()} />
    )
    expect(screen.getByText('ideas.detail.noLineage')).toBeInTheDocument()
    expect(screen.getByText('ideas.statusCaptured')).toBeInTheDocument()
  })

  it('renders empty Comments, Activity and Evidence section shells', () => {
    render(
      <IdeaDetailPanel idea={bare} workspaceUrl='lumo' onSave={jest.fn()} />
    )
    // The three reserved tabs are present (680/681 fill their content later).
    expect(screen.getByText('ideas.detail.tabComments')).toBeInTheDocument()
    expect(screen.getByText('ideas.detail.tabActivity')).toBeInTheDocument()
    expect(screen.getByText('ideas.detail.tabEvidence')).toBeInTheDocument()
    // The active section is an empty placeholder shell.
    expect(screen.getByTestId('idea-section-comments')).toHaveTextContent(
      'ideas.detail.comingSoon'
    )
  })

  it('saving an edited statement calls onSave with the new text', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    render(<IdeaDetailPanel idea={bare} workspaceUrl='lumo' onSave={onSave} />)

    fireEvent.click(screen.getByText('common.edit'))
    const textarea = screen.getByLabelText('ideas.detail.title')
    fireEvent.change(textarea, { target: { value: 'a sharper statement' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('a sharper statement')
    )
  })

  it('disables Save until the statement actually changes', () => {
    render(
      <IdeaDetailPanel idea={bare} workspaceUrl='lumo' onSave={jest.fn()} />
    )
    fireEvent.click(screen.getByText('common.edit'))
    // Unchanged from the original → Save is disabled (no-op edits blocked).
    expect(screen.getByText('common.save').closest('button')).toBeDisabled()
  })
})
