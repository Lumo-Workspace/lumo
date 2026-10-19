/** @jest-environment jsdom */
/**
 * LUM-1151 — the high-level summary setting sits in the review style of a
 * repository row: it shows the stored mode and its hint, and the owner
 * saves only what changed.
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
jest.mock('@/ee/security/hooks/useRepoReviewSettings', () => ({
  useRepoReviewSettings: jest.fn(),
  useUpdateRepoReviewSettings: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}))

import { RepoReviewSettingsCard } from '@/ee/security/components/settings/RepoReviewSettingsCard'
import { styleUpdate } from '@/ee/security/components/settings/RepoReviewStyleEditor'
import { useRepoReviewSettings } from '@/ee/security/hooks/useRepoReviewSettings'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'

const REPO = { repo: 'acme/app', ...DEFAULT_REPO_REVIEW_SETTING }

it('shows the stored mode with its hint', () => {
  ;(useRepoReviewSettings as jest.Mock).mockReturnValue({
    data: {
      canEdit: true,
      repositories: [{ ...REPO, highLevelSummary: 'comment' }],
    },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Show the review style for acme/app' })
  )
  expect(screen.getByText('High-level summary')).toBeTruthy()
  expect(screen.getByText("In Lumo's summary comment")).toBeTruthy()
  expect(
    screen.getByText(
      "The summary stays in Lumo's summary comment; the PR description is never edited."
    )
  ).toBeTruthy()
})

it('styleUpdate sends only a changed summary mode', () => {
  const draft = {
    highLevelSummary: 'description' as const,
    reviewProfile: REPO.reviewProfile,
    toneInstructions: '',
    pathInstructions: [],
    sequenceDiagrams: REPO.sequenceDiagrams,
  }
  expect(styleUpdate(REPO, draft)).toBeNull()
  expect(styleUpdate(REPO, { ...draft, highLevelSummary: 'off' })).toEqual({
    repo: 'acme/app',
    highLevelSummary: 'off',
  })
})
