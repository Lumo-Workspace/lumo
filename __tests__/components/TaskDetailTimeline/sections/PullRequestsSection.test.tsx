jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/components/LinkPrPopover', () => ({
  LinkPrPopover: () => <div data-testid='link-pr-popover' />,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/pr-helpers', () => ({
  PrStateBadge: () => <span data-testid='pr-state-badge' />,
  CiIcon: () => <span data-testid='ci-icon' />,
}))

import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { PullRequestsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection'

const baseProps = {
  taskId: 'tsk_1',
  workspaceId: 'ws_1',
  onLinkPr: jest.fn(),
  onUnlinkPr: jest.fn(),
}

describe('PullRequestsSection', () => {
  it('shows empty state when no PRs', () => {
    render(
      <Accordion type='multiple' defaultValue={['pullRequests']}>
        <PullRequestsSection {...baseProps} pullRequests={[]} />
      </Accordion>
    )
    expect(screen.getByText('task.noPullRequests')).toBeInTheDocument()
  })

  it('lists each PR', () => {
    render(
      <Accordion type='multiple' defaultValue={['pullRequests']}>
        <PullRequestsSection
          {...baseProps}
          pullRequests={[
            {
              id: 'pr1',
              number: 42,
              title: 'Add stuff',
              url: 'https://github.com/x/y/pull/42',
              state: 'open',
              ciStatus: 'success',
            },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('#42 Add stuff')).toBeInTheDocument()
  })

  it('renders count in header', () => {
    render(
      <Accordion type='multiple'>
        <PullRequestsSection
          {...baseProps}
          pullRequests={[
            {
              id: 'pr1',
              number: 1,
              title: 't',
              url: '#',
              state: 'open',
              ciStatus: null,
            },
            {
              id: 'pr2',
              number: 2,
              title: 't',
              url: '#',
              state: 'open',
              ciStatus: null,
            },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
