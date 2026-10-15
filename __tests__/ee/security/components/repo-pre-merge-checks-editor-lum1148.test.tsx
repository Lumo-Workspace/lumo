/** @jest-environment jsdom */
/**
 * LUM-1148 — a repository's pre-merge checks fold out under its row of the
 * repository review card: the owner sets each built-in's mode, adds a
 * natural-language check and the reviewers-only switch, and saves only what
 * changed; a non-owner sees them read-only.
 */
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const en = jest.requireActual('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, string>
      ) =>
        (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k: string) =>
          String(values?.[k] ?? `{${k}}`)
        ),
    }),
  }
})
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const mutateAsync = jest.fn().mockResolvedValue({})
jest.mock('@/ee/security/hooks/useRepoReviewSettings', () => ({
  useRepoReviewSettings: jest.fn(),
  useUpdateRepoReviewSettings: () => ({ mutateAsync, isPending: false }),
}))

import { RepoReviewSettingsCard } from '@/ee/security/components/settings/RepoReviewSettingsCard'
import {
  draftOfChecks,
  preMergeChecksUpdate,
} from '@/ee/security/components/settings/RepoPreMergeChecksEditor'
import { useRepoReviewSettings } from '@/ee/security/hooks/useRepoReviewSettings'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { parsePreMergeChecksSetting } from '@/ee/security/security-scan/pre-merge-checks'

const hook = useRepoReviewSettings as jest.Mock
const REPO = { repo: 'acme/app', ...DEFAULT_REPO_REVIEW_SETTING }

beforeEach(() => jest.clearAllMocks())

function open(canEdit: boolean) {
  hook.mockReturnValue({
    data: { canEdit, repositories: [REPO] },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Show the pre-merge checks for acme/app',
    })
  )
}

it('the owner sets modes, adds a check and saves only what changed', () => {
  open(true)
  const save = screen.getByRole('button', { name: 'Save checks' })
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Title check'), {
    target: { value: 'error' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }))
  fireEvent.change(screen.getByLabelText('Check name'), {
    target: { value: 'Changelog' },
  })
  fireEvent.change(screen.getByLabelText('Instructions'), {
    target: { value: 'Update CHANGELOG.md.' },
  })
  fireEvent.click(save)
  expect(mutateAsync).toHaveBeenCalledWith({
    repo: 'acme/app',
    preMergeChecks: {
      title: { mode: 'error' },
      customChecks: [
        {
          name: 'Changelog',
          mode: 'warning',
          instructions: 'Update CHANGELOG.md.',
        },
      ],
    },
  })
})

it('a non-owner sees the checks read-only', () => {
  open(false)
  expect(screen.getByLabelText('Title check')).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save checks' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Add check' })).toBeNull()
})

it('preMergeChecksUpdate: blank custom rows are dropped, "" clears the requirements', () => {
  const s = {
    ...parsePreMergeChecksSetting(null),
    title: { mode: 'warning' as const, requirements: 'prefix' },
  }
  const d = draftOfChecks(s)
  expect(preMergeChecksUpdate('a/b', s, d)).toBeNull()
  expect(
    preMergeChecksUpdate('a/b', s, {
      ...d,
      titleRequirements: ' ',
      customChecks: [{ name: '', mode: 'error', instructions: 'x' }],
      overrideRequestedReviewersOnly: true,
    })
  ).toEqual({
    repo: 'a/b',
    preMergeChecks: {
      title: { requirements: null },
      overrideRequestedReviewersOnly: true,
    },
  })
})
