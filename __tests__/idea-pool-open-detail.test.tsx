/** @jest-environment jsdom */

// react-intl → id-as-message with value interpolation + a deterministic date
// formatter (mirrors IdeaPoolPage.test).
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
import { render, screen, fireEvent } from '@testing-library/react'
import { IdeaPoolView } from '@/app/workspace/[workspaceUrl]/components/pages/IdeaPoolView'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

const idea: ApiIdea = {
  id: 'i7',
  number: 7,
  identifier: 'LUM-I7',
  statement: 'faster search',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: null,
  initiative: null,
}

function renderPool(onOpenIdea: (idea: ApiIdea) => void, ideas = [idea]) {
  return render(
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
      onAdvanceStatus={jest.fn().mockResolvedValue(undefined)}
    />
  )
}

describe('IdeaPoolView → detail slide-over', () => {
  it('clicking an idea row opens the detail panel for that idea', () => {
    const onOpenIdea = jest.fn()
    renderPool(onOpenIdea)

    fireEvent.click(screen.getByTestId('idea-row'))

    expect(onOpenIdea).toHaveBeenCalledTimes(1)
    expect(onOpenIdea).toHaveBeenCalledWith(idea)
  })

  it('opens the detail panel via keyboard (Enter) on a focused row', () => {
    const onOpenIdea = jest.fn()
    renderPool(onOpenIdea)

    fireEvent.keyDown(screen.getByTestId('idea-row'), { key: 'Enter' })

    expect(onOpenIdea).toHaveBeenCalledWith(idea)
  })
})
