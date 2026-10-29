/**
 * LUM-1339 — /settings/workspace is gone; the anchor and query of an old link
 * (sent notices carry `#data-retention`) decide where it lands.
 */
import { render } from '@testing-library/react'
import LegacyWorkspaceSettingsPage from '@/app/workspace/[workspaceUrl]/settings/workspace/page'

const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

beforeEach(() => mockReplace.mockClear())

it.each([
  ['', '/workspace/acme/settings/general'],
  ['#data-retention', '/workspace/acme/settings/data-retention'],
  ['#danger-zone', '/workspace/acme/settings/general#danger-zone'],
])('%p lands on %s', (hash, target) => {
  window.history.replaceState(
    {},
    '',
    `/workspace/acme/settings/workspace${hash}`
  )
  render(<LegacyWorkspaceSettingsPage />)
  expect(mockReplace).toHaveBeenCalledWith(target)
})

it('keeps the query string', () => {
  window.history.replaceState(
    {},
    '',
    '/workspace/acme/settings/workspace?ref=mail#ai-features'
  )
  render(<LegacyWorkspaceSettingsPage />)
  expect(mockReplace).toHaveBeenCalledWith(
    '/workspace/acme/settings/ai?ref=mail'
  )
})
