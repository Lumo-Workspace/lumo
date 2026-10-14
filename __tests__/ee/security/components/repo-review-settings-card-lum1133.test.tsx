/** @jest-environment jsdom */
/**
 * LUM-1133 — the per-repository automatic review card: one row per
 * connected repository, a switch saves that one field, a non-OWNER sees the
 * switches disabled, and a failed load never reads as "no repositories".
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
import { useRepoReviewSettings } from '@/ee/security/hooks/useRepoReviewSettings'

const hook = useRepoReviewSettings as jest.Mock
const DATA = {
  canEdit: true,
  repositories: [
    { repo: 'acme/app', autoReview: true, reviewDrafts: false },
    { repo: 'acme/web', autoReview: false, reviewDrafts: false },
  ],
}

beforeEach(() => jest.clearAllMocks())

it('renders a row per repository and saves the switch that changed', () => {
  hook.mockReturnValue({ data: DATA, isLoading: false, isError: false })
  render(<RepoReviewSettingsCard />)
  expect(screen.getByText('acme/app')).toBeTruthy()
  expect(screen.getByText('acme/web')).toBeTruthy()

  const appReview = screen.getByRole('switch', {
    name: 'Review pull requests in acme/app automatically',
  })
  expect(appReview.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(appReview)
  expect(mutateAsync).toHaveBeenCalledWith({
    repo: 'acme/app',
    autoReview: false,
  })

  // Drafts follow the review switch: off (and locked) when review is off.
  const webDrafts = screen.getByRole('switch', {
    name: 'Review draft pull requests in acme/web',
  })
  expect(webDrafts.hasAttribute('disabled')).toBe(true)
})

it('a non-OWNER sees the settings but cannot change them', () => {
  hook.mockReturnValue({
    data: { ...DATA, canEdit: false },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  expect(
    screen.getByText('Only workspace owners can change these settings.')
  ).toBeTruthy()
  for (const s of screen.getAllByRole('switch'))
    expect(s.hasAttribute('disabled')).toBe(true)
})

it('a failed load says so, never "no repositories"', () => {
  hook.mockReturnValue({ data: undefined, isLoading: false, isError: true })
  render(<RepoReviewSettingsCard />)
  expect(
    screen.getByText("Couldn't load the repository review settings.")
  ).toBeTruthy()
  expect(
    screen.queryByText('No repositories are connected to this workspace yet.')
  ).toBeNull()
})
