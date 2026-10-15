/** @jest-environment jsdom */
/**
 * LUM-1143 — the per-repository auto-review filters fold out under a row of
 * the repository review card; the owner edits them one entry per line and
 * saves only what changed; a non-owner sees them read-only.
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
  filtersUpdate,
  linesToList,
} from '@/ee/security/components/settings/RepoReviewFiltersEditor'
import { useRepoReviewSettings } from '@/ee/security/hooks/useRepoReviewSettings'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'

const hook = useRepoReviewSettings as jest.Mock
const REPO = {
  repo: 'acme/app',
  ...DEFAULT_REPO_REVIEW_SETTING,
  labels: ['bug'],
  emptyBaseBranchesMeans: 'all_branches' as const,
}

beforeEach(() => jest.clearAllMocks())

it('folds the filters out and saves only the changed ones', () => {
  hook.mockReturnValue({
    data: { canEdit: true, repositories: [REPO] },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  expect(screen.queryByText('Save filters')).toBeNull()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Show the automatic review filters for acme/app',
    })
  )
  expect(
    screen.getByText(
      'Empty = pull requests into any branch are reviewed. The default branch is always reviewed.'
    )
  ).toBeTruthy()
  const save = screen.getByRole('button', { name: 'Save filters' })
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.change(
    screen.getByLabelText('Skip titles containing (one per line, any case)'),
    { target: { value: 'WIP\n\nDraft ' } }
  )
  fireEvent.click(save)
  expect(mutateAsync).toHaveBeenCalledWith({
    repo: 'acme/app',
    ignoreTitleKeywords: ['WIP', 'Draft'],
  })
})

it('a non-owner sees the filters read-only, without a save button', () => {
  hook.mockReturnValue({
    data: { canEdit: false, repositories: [REPO] },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Show the automatic review filters for acme/app',
    })
  )
  expect(
    screen
      .getByLabelText('Labels (one per line; !label skips)')
      .hasAttribute('disabled')
  ).toBe(true)
  expect(screen.queryByRole('button', { name: 'Save filters' })).toBeNull()
})

it('filtersUpdate: an emptied keyword clears; unchanged is null', () => {
  const base = { ...REPO, descriptionKeyword: '/review' }
  const draft = {
    baseBranches: '',
    labels: 'bug',
    ignoreTitleKeywords: '',
    ignoreUsernames: '',
    pathFilters: '',
    descriptionKeyword: '/review',
  }
  expect(filtersUpdate(base, draft)).toBeNull()
  expect(filtersUpdate(base, { ...draft, descriptionKeyword: ' ' })).toEqual({
    repo: 'acme/app',
    descriptionKeyword: null,
  })
  expect(linesToList(' a \n\n b')).toEqual(['a', 'b'])
})
