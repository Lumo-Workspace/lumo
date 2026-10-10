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
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed.client', () => ({
  INSTALLED_CLIENT_PLUGINS: [],
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

  it('LUM-889 says why a PR of a repository off the confirmed list is not refreshed', () => {
    const pr = {
      number: 7,
      title: 'Payroll',
      url: 'https://github.com/acme/payroll/pull/7',
      state: 'open',
      ciStatus: null,
    }
    render(
      <Accordion type='multiple' defaultValue={['pullRequests']}>
        <PullRequestsSection
          {...baseProps}
          pullRequests={[
            { ...pr, id: 'pr_paused', statusSyncPaused: true },
            { ...pr, id: 'pr_live', number: 8 },
          ]}
        />
      </Accordion>
    )
    const notes = screen.getAllByTestId('pr-status-sync-paused')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveTextContent('task.prStatusSyncPaused')
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

  // ── LUM-732 review I4 — the badge must not speak for data it doesn't have ──
})
