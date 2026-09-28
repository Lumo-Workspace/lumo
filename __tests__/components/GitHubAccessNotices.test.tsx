/** @jest-environment jsdom */
/**
 * LUM-888 — the settings card says *why* repositories were removed: a lost
 * permission, or a verifying GitHub account that no longer exists (and how an
 * owner restores access). react-intl is ESM-only under jest, so the notice is
 * rendered with a stub that prints the message id it picked, and the shipped
 * English copy for that id is checked against the catalogue.
 */
import { render, screen } from '@testing-library/react'
import en from '@/lib/i18n/en.json'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: { count?: number }) =>
      values?.count === undefined ? id : `${id}:${values.count}`,
  }),
}))

import { GitHubAccessNotices } from '@/app/workspace/[workspaceUrl]/components/GitHubAccessNotices'

const catalogue = en as Record<string, string>

describe('GitHubAccessNotices', () => {
  it('LUM-888 renamed verifier is followed by id: a deleted account gets its own notice', () => {
    render(
      <GitHubAccessNotices
        accessRecheckEnabled
        accessRemovedCount={3}
        accessRemovedReason='account_gone'
      />
    )
    expect(
      screen.getByText('github.accessRemovedAccountGone:3')
    ).toBeInTheDocument()
    // What that notice says: the account is gone (not lost permissions), and
    // how an owner gets the repositories back.
    const copy = catalogue['github.accessRemovedAccountGone'] ?? ''
    expect(copy).toContain('no longer exists')
    expect(copy).toContain('renamed')
    expect(copy).toContain('re-verify GitHub access to restore')
    expect(copy).not.toContain('can no longer read')
  })

  it('keeps the lost-permission wording for access_lost and legacy rows', () => {
    for (const reason of ['access_lost', null, undefined]) {
      const { unmount } = render(
        <GitHubAccessNotices
          accessRecheckEnabled
          accessRemovedCount={1}
          accessRemovedReason={reason}
        />
      )
      expect(screen.getByText('github.accessRemoved:1')).toBeInTheDocument()
      unmount()
    }
  })

  it('renders nothing with no removals and the recheck on', () => {
    const { container } = render(
      <GitHubAccessNotices accessRecheckEnabled accessRemovedCount={0} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
