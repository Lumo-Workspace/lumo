/**
 * LUM-1267: the sprint status filter is a chip ToggleGroup with an
 * accessible name, and it stays single-select.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import enJson from '@/lib/i18n/en.json'

const messages = enJson as Record<string, string>
const t = (id: string): string => messages[id] ?? id

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
      formatDate: () => '',
    }),
  }
})

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
jest.mock('@/hooks/use-now', () => ({ useNow: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintsForTeam: () => ({
    sprints: [],
    setSprints: jest.fn(),
    isLoading: false,
    refetch: jest.fn(),
  }),
  useSprint: () => ({ progress: null }),
}))
jest.mock('@/lib/api-client', () => ({ sprintsClient: {} }))

import { SprintsBoard } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintsBoard'

function renderBoard() {
  render(<SprintsBoard teamId='team-1' />)
  fireEvent.click(screen.getByRole('button', { name: /Search/ }))
}

it('names the status filter group', () => {
  renderBoard()
  const group = screen.getByRole('group', {
    name: t('sprints.statusFilter.label'),
  })
  expect(group).toBeInTheDocument()
  expect(
    screen.getByRole('radio', { name: t('sprints.filter.all') })
  ).toHaveAttribute('aria-checked', 'true')
})

it('moves the selection and never clears it', () => {
  renderBoard()
  const all = screen.getByRole('radio', { name: t('sprints.filter.all') })
  const active = screen.getByRole('radio', {
    name: t('sprints.status.active'),
  })
  fireEvent.click(active)
  expect(active).toHaveAttribute('aria-checked', 'true')
  expect(all).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(active)
  expect(active).toHaveAttribute('aria-checked', 'true')
})
