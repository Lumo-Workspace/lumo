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
    formatMessage: (
      { id }: { id: string },
      values?: { count?: number; since?: string }
    ) =>
      values?.since !== undefined
        ? `${id}:${values.since}`
        : values?.count === undefined
          ? id
          : `${id}:${values.count}`,
    formatDate: (value: string) => `date(${value})`,
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
    expect(copy).toContain('can no longer find the account')
    expect(copy).toContain('renamed')
    expect(copy).toContain('re-verify GitHub access to restore')
    expect(copy).not.toContain('can no longer read')
  })

  it('LUM-895 account-not-found notice does not claim the account was deleted', () => {
    // GET /user/{id} answers 404 for a suspended account exactly as for a
    // deleted one, so no locale may state the account is gone for good.
    const locales = [
      'de',
      'en-AU',
      'en-GB',
      'en',
      'es-419',
      'es',
      'fr',
      'hi',
      'id',
      'ja',
      'ko',
      'ms',
      'ru',
      'vi',
      'zh-CN',
      'zh-TW',
    ]
    const copyOf = (locale: string) =>
      (
        jest.requireActual(`@/lib/i18n/${locale}.json`) as Record<
          string,
          string
        >
      )['github.accessRemovedAccountGone'] ?? ''
    const english = copyOf('en')
    expect(english).toContain('suspended')
    expect(english).not.toContain('no longer exists')
    expect(copyOf('zh-CN')).toContain('封禁')
    expect(copyOf('zh-CN')).not.toContain('已不存在')
    expect(copyOf('zh-TW')).not.toContain('已不存在')
    for (const locale of locales) {
      const copy = copyOf(locale)
      expect(copy).not.toBe('')
      if (!locale.startsWith('en')) expect(copy).not.toBe(english)
    }
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

  it('LUM-927 shows the token failure notice', () => {
    const { rerender } = render(
      <GitHubAccessNotices
        accessRecheckEnabled
        accessRemovedCount={0}
        tokenFailingSince='2026-09-27T00:00:00.000Z'
      />
    )
    // The notice dates the failure run with the viewer's locale.
    expect(
      screen.getByText('github.tokenFailing:date(2026-09-27T00:00:00.000Z)')
    ).toBeInTheDocument()
    // It names the usual cause and who fixes it, and does not claim scans
    // stopped: the scan token is a different permission set.
    const copy = catalogue['github.tokenFailing'] ?? ''
    expect(copy).toContain('{since}')
    expect(copy).toContain('permissions')
    expect(copy).not.toMatch(/scann/i)

    rerender(
      <GitHubAccessNotices
        accessRecheckEnabled
        accessRemovedCount={0}
        tokenFailingSince={null}
      />
    )
    expect(screen.queryByText(/github\.tokenFailing/)).not.toBeInTheDocument()
  })
})
