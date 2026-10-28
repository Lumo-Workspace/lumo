/** @jest-environment jsdom */
/**
 * LUM-1133 / LUM-1331 — the automatic review card: a table row per
 * connected repository with a summary of what it sets apart, switches that
 * save at once, and a Configure sheet that saves every section with one
 * PATCH. A non-OWNER sees everything read-only; a failed load never reads
 * as "no repositories".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('react-intl', () => {
  const en = jest.requireActual('@/lib/i18n/en.json') as Record<string, string>
  // `{count, plural, one {…} other {…}}` → the `other` branch with # filled.
  const plural = (text: string, values?: Record<string, unknown>) =>
    text.replace(
      /\{(\w+), plural,(?:[^{}]*\{[^{}]*\})*?\s*other \{([^{}]*)\}\}/g,
      (_, k: string, other: string) => other.replace('#', String(values?.[k]))
    )
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) =>
        plural(en[id] ?? id, values).replace(/\{(\w+)\}/g, (_, k: string) =>
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
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'

const hook = useRepoReviewSettings as jest.Mock
const APP = {
  repo: 'acme/app',
  ...DEFAULT_REPO_REVIEW_SETTING,
  ignoreUsernames: ['renovate[bot]'],
  emptyBaseBranchesMeans: 'default_branch_only' as const,
}
const WEB = {
  repo: 'acme/web',
  ...DEFAULT_REPO_REVIEW_SETTING,
  autoReview: false,
  emptyBaseBranchesMeans: 'default_branch_only' as const,
}

function show(canEdit = true) {
  hook.mockReturnValue({
    data: { canEdit, repositories: [APP, WEB] },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
}

const configure = (repo: string) =>
  fireEvent.click(
    screen.getByRole('button', {
      name: `Configure automatic review for ${repo}`,
    })
  )

beforeEach(() => jest.clearAllMocks())

it('renders a row per repository with its summary and saves a switch at once', () => {
  show()
  expect(screen.getByText('acme/app')).toBeTruthy()
  expect(screen.getByText('1 skip rules')).toBeTruthy()
  expect(screen.getByText(/^Off: reviewed only on request/)).toBeTruthy()

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

it('Configure opens the sheet; edits across tabs save as one PATCH', async () => {
  show()
  configure('acme/app')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByText('No unsaved changes')).toBeTruthy()

  // When to review: a skipped title keyword, added as a chip.
  const titles = screen.getByLabelText('Titles containing')
  fireEvent.change(titles, { target: { value: 'WIP' } })
  fireEvent.keyDown(titles, { key: 'Enter' })
  expect(screen.getByText('WIP')).toBeTruthy()

  // Review style: the assertive profile.
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Review style' }))
  fireEvent.click(screen.getByRole('radio', { name: /Assertive/ }))

  expect(screen.getByText('2 unsaved changes')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(mutateAsync).toHaveBeenCalledWith({
    repo: 'acme/app',
    ignoreTitleKeywords: ['WIP'],
    reviewProfile: 'assertive',
  })
})

it('Discard puts the stored values back', () => {
  show()
  configure('acme/app')
  fireEvent.click(screen.getByRole('button', { name: 'Remove renovate[bot]' }))
  expect(screen.queryByText('renovate[bot]')).toBeNull()
  expect(screen.getByText('1 unsaved changes')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
  expect(screen.getByText('renovate[bot]')).toBeTruthy()
  expect(screen.getByText('No unsaved changes')).toBeTruthy()
})

it('closing with unsaved changes asks first', () => {
  show()
  configure('acme/app')
  fireEvent.click(screen.getByRole('button', { name: 'Remove renovate[bot]' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByText('Discard unsaved changes?')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
  expect(screen.getByText('1 unsaved changes')).toBeTruthy()
})

it('a pattern that does not compile is refused, and an empty pattern list blocks Save', () => {
  show()
  configure('acme/app')
  fireEvent.click(screen.getByRole('radio', { name: /Default \+ matching/ }))
  expect(
    screen.getByText('Add at least one pattern, or pick another option.')
  ).toBeTruthy()
  expect(
    screen
      .getByRole('button', { name: 'Save changes' })
      .hasAttribute('disabled')
  ).toBe(true)

  const patterns = screen.getByPlaceholderText(
    'Add a regular expression, e.g. release/.*'
  )
  fireEvent.change(patterns, { target: { value: 'release/(' } })
  fireEvent.keyDown(patterns, { key: 'Enter' })
  expect(
    screen.getByText('"release/(" isn\'t a valid regular expression.')
  ).toBeTruthy()
  fireEvent.change(patterns, { target: { value: 'release/.*' } })
  fireEvent.keyDown(patterns, { key: 'Enter' })
  expect(
    screen
      .getByRole('button', { name: 'Save changes' })
      .hasAttribute('disabled')
  ).toBe(false)
})

it('a non-OWNER sees the settings but cannot change them', () => {
  show(false)
  expect(
    screen.getAllByText('Only workspace owners can change these settings.')
      .length
  ).toBeGreaterThan(0)
  for (const s of screen.getAllByRole('switch'))
    expect(s.hasAttribute('disabled')).toBe(true)

  configure('acme/app')
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  expect(screen.queryByLabelText('Titles containing')).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Remove renovate[bot]' })
  ).toBeNull()
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
