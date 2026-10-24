/** @jest-environment jsdom */
import '@testing-library/jest-dom'

// While the sprint loads, the detail page shows a layout-shaped skeleton —
// no visible "Loading…" text in the body or the breadcrumb; the label stays
// for screen readers via role=status.

jest.mock('react-intl', () => {
  const intl = {
    locale: 'en-US',
    formatMessage: ({ id }: { id: string }) => id,
  }
  return { useIntl: () => intl }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'test-workspace', sprintId: '14' }),
}))

jest.mock('@/components/RichHtml', () => ({
  RichHtml: ({ html }: { html: string }) => <div>{html}</div>,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const mockLoading = {
  sprint: undefined,
  isLoading: true,
  error: null,
  refetch: () => {},
}
const mockDisabled = { attention: null, isLoading: false, error: undefined }
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintByNumber: () => mockLoading,
  useSprintTasks: () => ({ tasks: undefined, refetch: () => {} }),
  useSprintsForTeam: () => ({ sprints: undefined }),
  useSprintAttention: () => mockDisabled,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTeams', () => ({
  useWorkspaceTeams: () => ({ teams: [] }),
}))

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SprintDetailClient } from '@/app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient'
import { RetroCard } from '@/app/workspace/[workspaceUrl]/sprints/components/detail/RetroCard'

test('loading renders skeletons with a screen-reader-only label', () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <SprintDetailClient />
    </QueryClientProvider>
  )

  const status = screen.getByRole('status')
  expect(status).toHaveAttribute('aria-busy', 'true')
  // The only copy of the label is the sr-only one inside the status region.
  const labels = screen.getAllByText('sprints.detail.loading')
  expect(labels).toHaveLength(1)
  expect(labels[0]).toHaveClass('sr-only')
  expect(
    container.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(4)
})

test('RetroCard loading shows a skeleton subtitle, not "Loading retro…" text', () => {
  const { container } = render(
    <RetroCard
      loading
      readFailed={false}
      retro={null}
      retrying={false}
      retryError={null}
      onRetry={() => {}}
    />
  )

  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByText('sprints.retro.loading')).toHaveClass('sr-only')
  expect(screen.queryByText('sprints.retro.generating')).not.toBeInTheDocument()
  expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
})
