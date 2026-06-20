/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const template = defaultMessage ?? id
      if (!values) return template
      return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_m, k) =>
        values[k] != null ? String(values[k]) : _m
      )
    },
  }),
}))

// next/link → plain anchor so jsdom can read the href without a router.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : ''} {...rest}>
      {children}
    </a>
  ),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDependencies', () => ({
  useDependencies: jest.fn(),
}))

// The dialog body pulls in AddDependencyButton's Popover/Command subtree —
// stub the whole DependenciesSection; this suite only tests the field summary.
jest.mock(
  '@/app/workspace/[workspaceUrl]/dependencies/components/DependenciesSection',
  () => ({ DependenciesSection: () => <div data-testid='deps-section' /> })
)

import { render, screen } from '@testing-library/react'
import { TaskDependencyField } from '@/app/workspace/[workspaceUrl]/components/TaskDependencyField'
import { useDependencies } from '@/app/workspace/[workspaceUrl]/hooks/useDependencies'
import type { DependencyEdge } from '@/app/workspace/[workspaceUrl]/dependencies/types'

const edge = (o: Partial<DependencyEdge>): DependencyEdge => ({
  id: Math.random().toString(36).slice(2),
  direction: 'BLOCKED_BY',
  kind: 'BLOCKS',
  source: 'MANUAL',
  status: 'CONFIRMED',
  reason: null,
  detail: null,
  other: { identifier: 'LUM-9', title: 'Blocker', status: 'TODO' },
  ...o,
})

function mockEdges(edges: DependencyEdge[]) {
  ;(useDependencies as jest.Mock).mockReturnValue({
    edges,
    loading: false,
    error: null,
    add: { mutate: jest.fn(), isPending: false },
    patch: { mutate: jest.fn(), isPending: false },
    remove: { mutate: jest.fn(), isPending: false },
  })
}

function renderField(edges: DependencyEdge[]) {
  mockEdges(edges)
  return render(
    <TaskDependencyField taskIdentifier='LUM-42' workspaceUrl='acme' />
  )
}

const blocker = (id: string, status = 'TODO') =>
  edge({ other: { identifier: id, title: id, status } })

it('TaskDependencyField renders bounded blocker chips and trailing counts', () => {
  renderField([
    blocker('LUM-1'),
    blocker('LUM-2'),
    blocker('LUM-3'),
    blocker('LUM-4'),
    edge({
      direction: 'BLOCKS',
      other: { identifier: 'LUM-5', title: 'down', status: 'TODO' },
    }),
    edge({
      status: 'SUGGESTED',
      other: { identifier: 'LUM-6', title: 'maybe', status: 'TODO' },
    }),
  ])
  expect(screen.getByText('LUM-1')).toBeInTheDocument()
  expect(screen.getByText('LUM-2')).toBeInTheDocument()
  expect(screen.getByText('LUM-3')).toBeInTheDocument()
  expect(screen.queryByText('LUM-4')).not.toBeInTheDocument()
  expect(screen.getByText('+1')).toBeInTheDocument()
  expect(screen.getByText('LUM-1').closest('a')).toHaveAttribute(
    'href',
    '/workspace/acme/my-tasks/LUM-1'
  )
  expect(screen.getByText('blocks 1')).toBeInTheDocument()
  expect(screen.getByText('1 suggested')).toBeInTheDocument()
})

it('TaskDependencyField surfaces a live blocker in red without opening the dialog', () => {
  renderField([blocker('LUM-9', 'IN_PROGRESS')])
  expect(screen.queryByTestId('deps-section')).not.toBeInTheDocument()
  const indicator = screen.getByTestId('deps-blocked-indicator')
  expect(indicator).toBeInTheDocument()
  expect(
    screen.getByText('LUM-9').closest('[data-blocker-state]')
  ).toHaveAttribute('data-blocker-state', 'live')
})

it('TaskDependencyField renders a DONE blocker as satisfied and excludes it from the live count', () => {
  renderField([blocker('LUM-9', 'DONE')])
  expect(screen.queryByTestId('deps-blocked-indicator')).not.toBeInTheDocument()
  expect(
    screen.getByText('LUM-9').closest('[data-blocker-state]')
  ).toHaveAttribute('data-blocker-state', 'satisfied')
})

it('renders the empty state when there are no edges', () => {
  const { container } = renderField([])
  // react-intl mock returns the key id when no defaultMessage is supplied.
  expect(
    screen.getByText('task.dependencies.addDependency')
  ).toBeInTheDocument()
  expect(container.querySelector('a')).toBeNull()
})

it('shows no dangling separator when only suggested candidates exist', () => {
  const { container } = renderField([
    edge({
      status: 'SUGGESTED',
      other: { identifier: 'LUM-6', title: 'maybe', status: 'TODO' },
    }),
  ])
  expect(screen.getByText('1 suggested')).toBeInTheDocument()
  expect(container.textContent?.trim().startsWith('·')).toBe(false)
})

it('offers the manage control (no stray GitFork) when only blockers exist', () => {
  const { container } = renderField([blocker('LUM-9', 'IN_PROGRESS')])
  expect(screen.getByText('LUM-9')).toBeInTheDocument()
  // No GitFork in the field row (it lives only in the dialog title).
  expect(container.querySelector('.lucide-git-fork')).toBeNull()
  // A manage control is always present to open the dialog.
  expect(
    screen.getByRole('button', { name: 'task.dependencies.field.manage' })
  ).toBeInTheDocument()
})

it('always offers a manage control when only satisfied blockers exist (no dead state)', () => {
  // The state that previously had no opener: blockers all DONE, no blocks/suggested/overflow.
  renderField([blocker('LUM-1', 'DONE'), blocker('LUM-2', 'DONE')])
  // Chips are navigation links, not the dialog opener.
  expect(screen.getByText('LUM-1').closest('a')).toHaveAttribute(
    'href',
    '/workspace/acme/my-tasks/LUM-1'
  )
  // …so an explicit manage control must exist to open the management dialog.
  expect(
    screen.getByRole('button', { name: 'task.dependencies.field.manage' })
  ).toBeInTheDocument()
})

it('does not show the empty state when only RELATES edges exist', () => {
  renderField([
    edge({
      kind: 'RELATES',
      status: 'CONFIRMED',
      other: { identifier: 'LUM-7', title: 'related', status: 'TODO' },
    }),
  ])
  // Empty-state add affordance must be absent…
  expect(
    screen.queryByText('task.dependencies.addDependency')
  ).not.toBeInTheDocument()
  // …and the manage control is present to open the dialog.
  expect(
    screen.getByRole('button', { name: 'task.dependencies.field.manage' })
  ).toBeInTheDocument()
})

it('renders blocker chips as links wrapped in a tooltip (id + title shown on hover)', () => {
  // The tooltip content is portaled + hover-gated, so jsdom can't render it
  // (Radix overlays don't open here). We assert the chip stays a working link
  // after being wrapped in TooltipTrigger asChild — the regression that matters.
  renderField([
    edge({
      other: { identifier: 'LUM-9', title: 'auth refactor', status: 'TODO' },
    }),
  ])
  const chip = screen.getByText('LUM-9').closest('a')
  expect(chip).toHaveAttribute('href', '/workspace/acme/my-tasks/LUM-9')
  expect(chip).toHaveAttribute('data-blocker-state', 'live')
})
