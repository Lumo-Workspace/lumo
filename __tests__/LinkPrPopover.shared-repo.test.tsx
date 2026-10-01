/** @jest-environment jsdom */
/**
 * LUM-929 — a manual link claims the PR, and the task's comments are then
 * posted to it on GitHub. When another workspace also confirmed the PR's
 * repository the popover says so after linking; otherwise it stays quiet.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// react-intl ships ESM that jest does not transform; ids stand in for copy.
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  FormattedMessage: ({ id }: { id: string }) => id,
}))
jest.mock('sonner', () => ({
  toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: { linkPr: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePrSearch', () => ({
  usePrSearch: () => ({
    loading: false,
    results: [
      {
        id: 'pr-1',
        repo: 'acme/web',
        number: 9,
        title: 'Shared PR',
        url: 'https://github.com/acme/web/pull/9',
        state: 'open',
        ciStatus: null,
        authorLogin: 'octo',
        headBranch: 'feature',
        createdAt: '2026-10-01T00:00:00Z',
        task: null,
      },
    ],
  }),
}))

import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import { LinkPrPopover } from '@/app/workspace/[workspaceUrl]/components/LinkPrPopover'

const linkPr = tasksClient.linkPr as jest.Mock

async function linkThePr() {
  const onLinked = jest.fn()
  render(<LinkPrPopover taskId='t1' workspaceId='w1' onLinked={onLinked} />)
  fireEvent.click(screen.getByRole('button', { name: 'linkPr.title' }))
  fireEvent.click(await screen.findByText('Shared PR'))
  await waitFor(() => expect(onLinked).toHaveBeenCalled())
}

beforeEach(() => jest.clearAllMocks())

it('warns after linking a PR that another workspace also uses', async () => {
  linkPr.mockResolvedValue({
    pullRequest: { id: 'pr-1' },
    sharedWithOtherWorkspaces: true,
  })
  await linkThePr()
  expect(linkPr).toHaveBeenCalledWith('t1', { prId: 'pr-1' })
  expect(toast.warning).toHaveBeenCalledWith('linkPr.sharedRepoWarning')
})

it('links without a warning when the repository is not shared', async () => {
  linkPr.mockResolvedValue({
    pullRequest: { id: 'pr-1' },
    sharedWithOtherWorkspaces: false,
  })
  await linkThePr()
  expect(toast.warning).not.toHaveBeenCalled()
})
