/** @jest-environment jsdom */

// LUM-708: the pool row's status badge is a one-click "advance" control. It
// walks the lifecycle forward (CAPTURED → DEVELOPING → PLANNED → DROPPED),
// persists through the status PATCH, stops at the terminal DROPPED, and must
// never open the detail drawer the surrounding row owns.

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${Object.values(values).join(' ')}` : id),
    formatDate: (d: Date) => `date:${d.getUTCFullYear()}`,
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
import { render, screen, fireEvent, within } from '@testing-library/react'
import { IdeaPoolView } from '@/app/workspace/[workspaceUrl]/components/pages/IdeaPoolView'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

const base: ApiIdea = {
  id: 'i0',
  number: 0,
  identifier: 'LUM-I0',
  statement: '',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: null,
  initiative: null,
}

const ideaOf = (status: ApiIdea['status']): ApiIdea => ({
  ...base,
  id: `i-${status}`,
  identifier: `LUM-I-${status}`,
  statement: `${status.toLowerCase()} idea`,
  status,
})

function renderPool(ideas: ApiIdea[]) {
  const onOpenIdea = jest.fn()
  const onAdvanceStatus = jest.fn().mockResolvedValue(undefined)
  render(
    <IdeaPoolView
      ideas={ideas}
      loading={false}
      error={null}
      onRetry={jest.fn()}
      workspaceUrl='lumo'
      planRuns={[]}
      planRunsLoading={false}
      planRunsError={null}
      clustering={null}
      onOpenIdea={onOpenIdea}
      onCaptureIdea={jest.fn().mockResolvedValue(undefined)}
      onAdvanceStatus={onAdvanceStatus}
    />
  )
  return { onOpenIdea, onAdvanceStatus }
}

const badgeIn = (status: ApiIdea['status']) => {
  const row = screen
    .getAllByTestId('idea-row')
    .find(r => r.getAttribute('data-status') === status)!
  return within(row).getByTestId('idea-status-badge')
}

describe('idea pool status badge', () => {
  it('cycles the status in place without opening the detail drawer', () => {
    const { onOpenIdea, onAdvanceStatus } = renderPool([
      ideaOf('CAPTURED'),
      ideaOf('DEVELOPING'),
      ideaOf('PLANNED'),
      ideaOf('DROPPED'),
    ])

    // Each click asks for the next status the lifecycle actually allows.
    fireEvent.click(badgeIn('CAPTURED'))
    expect(onAdvanceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'CAPTURED' }),
      'DEVELOPING'
    )

    fireEvent.click(badgeIn('DEVELOPING'))
    expect(onAdvanceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'DEVELOPING' }),
      'PLANNED'
    )

    fireEvent.click(badgeIn('PLANNED'))
    expect(onAdvanceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'PLANNED' }),
      'DROPPED'
    )

    // DROPPED is terminal — its badge is inert, so no fourth call.
    expect(badgeIn('DROPPED')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(badgeIn('DROPPED'))
    expect(onAdvanceStatus).toHaveBeenCalledTimes(3)

    // Not one of those clicks leaked through to the row's open handler.
    expect(onOpenIdea).not.toHaveBeenCalled()
  })

  it('still opens the drawer when the row itself is clicked', () => {
    const { onOpenIdea, onAdvanceStatus } = renderPool([ideaOf('CAPTURED')])

    fireEvent.click(screen.getByTestId('idea-row'))

    expect(onOpenIdea).toHaveBeenCalledTimes(1)
    expect(onAdvanceStatus).not.toHaveBeenCalled()
  })
})
