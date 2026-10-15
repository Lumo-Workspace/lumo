/** @jest-environment jsdom */
/**
 * LUM-1147 — the review style (profile, tone, path instructions) folds out
 * under a row of the repository review card; the owner saves only what
 * changed; a non-owner sees it read-only.
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
import { styleUpdate } from '@/ee/security/components/settings/RepoReviewStyleEditor'
import { useRepoReviewSettings } from '@/ee/security/hooks/useRepoReviewSettings'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'

const hook = useRepoReviewSettings as jest.Mock
const REPO = {
  repo: 'acme/app',
  ...DEFAULT_REPO_REVIEW_SETTING,
  pathInstructions: [{ path: 'lib/**', instructions: 'Check limits.' }],
}

beforeEach(() => jest.clearAllMocks())

function open(canEdit: boolean) {
  hook.mockReturnValue({
    data: { canEdit, repositories: [REPO] },
    isLoading: false,
    isError: false,
  })
  render(<RepoReviewSettingsCard />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Show the review style for acme/app' })
  )
}

it('adds a path instruction and a tone, and saves only those', () => {
  open(true)
  const save = screen.getByRole('button', { name: 'Save review style' })
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Add instruction' }))
  const globs = screen.getAllByLabelText('Path glob')
  const texts = screen.getAllByLabelText('Instructions for matching files')
  expect(globs).toHaveLength(2)
  fireEvent.change(globs[1]!, { target: { value: ' scripts/** ' } })
  fireEvent.change(texts[1]!, { target: { value: 'Flag any console.log.' } })
  fireEvent.change(
    screen.getByLabelText('Tone (optional, up to 250 characters)'),
    { target: { value: 'Be terse' } }
  )
  fireEvent.click(save)
  expect(mutateAsync).toHaveBeenCalledWith({
    repo: 'acme/app',
    toneInstructions: 'Be terse',
    pathInstructions: [
      { path: 'lib/**', instructions: 'Check limits.' },
      { path: 'scripts/**', instructions: 'Flag any console.log.' },
    ],
  })
})

it('a non-owner sees the style read-only, without add / remove / save', () => {
  open(false)
  expect(screen.getByLabelText('Path glob').hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Save review style' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Add instruction' })).toBeNull()
})

it('styleUpdate: unchanged is null; profile change and cleared rows are sent', () => {
  const draft = {
    reviewProfile: 'chill' as const,
    toneInstructions: '',
    pathInstructions: [{ path: 'lib/**', instructions: 'Check limits.' }],
  }
  expect(styleUpdate(REPO, draft)).toBeNull()
  expect(
    styleUpdate(REPO, {
      ...draft,
      reviewProfile: 'quiet',
      pathInstructions: [{ path: '', instructions: '' }],
    })
  ).toEqual({ repo: 'acme/app', reviewProfile: 'quiet', pathInstructions: [] })
})
