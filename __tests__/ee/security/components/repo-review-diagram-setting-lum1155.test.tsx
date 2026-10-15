/** @jest-environment jsdom */
/**
 * LUM-1155 — the sequence-diagram switch sits in the review style of a
 * repository row: it shows the stored value with its hint, and the owner
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

it('shows the switch with its stored value and hint', () => {
  ;(useRepoReviewSettings as jest.Mock).mockReturnValue({
    data: {
      canEdit: true,
      repositories: [{ ...REPO, sequenceDiagrams: false }],
    },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Show the review style for acme/app' })
  )
  const toggle = screen.getByRole('switch', {
    name: 'Sequence diagram of the call flow',
  })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(
    screen.getByText(/gets a sequence diagram of its main flow/)
  ).toBeTruthy()
})

it('styleUpdate sends only a changed switch', () => {
  const draft = {
    highLevelSummary: REPO.highLevelSummary,
    reviewProfile: REPO.reviewProfile,
    toneInstructions: '',
    pathInstructions: [],
    sequenceDiagrams: true,
  }
  expect(styleUpdate(REPO, draft)).toBeNull()
  expect(styleUpdate(REPO, { ...draft, sequenceDiagrams: false })).toEqual({
    repo: 'acme/app',
    sequenceDiagrams: false,
  })
})
