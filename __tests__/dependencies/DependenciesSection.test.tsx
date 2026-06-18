/** @jest-environment jsdom */

// react-intl ships pure ESM — mock it the same way other component tests do.
// The mock returns the message key id as the template (no defaultMessage), so
// assertions use the key id string or check by role/class rather than translated text.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const template = defaultMessage ?? id
      if (!values) return template
      return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_match, key) =>
        values[key] != null ? String(values[key]) : _match
      )
    },
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDependencies', () => ({
  useDependencies: jest.fn(),
}))

// AddDependencyButton uses Popover/Command and mention search — stub it out so
// this suite is not coupled to that subtree.
jest.mock(
  '@/app/workspace/[workspaceUrl]/dependencies/components/AddDependencyButton',
  () => ({
    AddDependencyButton: () => <button type='button'>Add dependency</button>,
  })
)

import { render, screen } from '@testing-library/react'
import { DependenciesSection } from '@/app/workspace/[workspaceUrl]/dependencies/components/DependenciesSection'
import { useDependencies } from '@/app/workspace/[workspaceUrl]/hooks/useDependencies'
import type { DependencyEdge } from '@/app/workspace/[workspaceUrl]/dependencies/types'

const edge = (o: Partial<DependencyEdge>): DependencyEdge => ({
  id: 'e1',
  direction: 'BLOCKED_BY',
  kind: 'BLOCKS',
  source: 'MANUAL',
  status: 'CONFIRMED',
  reason: null,
  detail: null,
  other: { identifier: 'LUM-9', title: 'Token schema', status: 'TODO' },
  ...o,
})

function renderSection(edges: DependencyEdge[]) {
  ;(useDependencies as jest.Mock).mockReturnValue({
    edges,
    loading: false,
    error: null,
    add: { mutate: jest.fn(), isPending: false },
    patch: { mutate: jest.fn(), isPending: false },
    remove: { mutate: jest.fn(), isPending: false },
  })
  return render(<DependenciesSection taskIdentifier='LUM-42' />)
}

it('shows the live-blocker banner when a confirmed BLOCKS blocker is not done', () => {
  // The react-intl mock returns the key id as-is (no defaultMessage in en.json calls).
  // The banner div is rendered with the key 'task.dependencies.blockedAlert' as its text.
  // We assert the banner container is present AND the blocker identifier appears (in DependencyRow).
  renderSection([
    edge({
      other: { identifier: 'LUM-12', title: 'Auth', status: 'IN_PROGRESS' },
    }),
  ])
  // Banner div contains the (mock-returned) alert key — proves liveBlockers.length > 0 branch fired
  expect(screen.getByText('task.dependencies.blockedAlert')).toBeInTheDocument()
  // The blocker identifier renders in the DependencyRow (confirmed blocked-by group)
  expect(screen.getByText('LUM-12')).toBeInTheDocument()
})

it('renders a Blocks group for an outgoing edge', () => {
  renderSection([
    edge({
      id: 'b',
      direction: 'BLOCKS',
      other: { identifier: 'LUM-88', title: 'SSO', status: 'TODO' },
    }),
  ])
  expect(screen.getByText('LUM-88')).toBeInTheDocument()
  // Group heading key for outgoing edges — mock returns the key id verbatim
  expect(screen.getByText('task.dependencies.blocks')).toBeInTheDocument()
})

it('renders suggested edges with evidence and does not show the banner for them', () => {
  renderSection([
    edge({
      id: 's',
      status: 'SUGGESTED',
      source: 'DETECTED',
      reason: 'shared_files',
      detail: { count: 5 },
    }),
  ])
  // evidenceText returns "shares 5 files" — rendered directly in DependencyRow (not via intl)
  expect(
    screen.getByText('shares 5 files', { exact: false })
  ).toBeInTheDocument()
  // computeLiveBlockers requires CONFIRMED status — no banner for SUGGESTED edges
  expect(
    screen.queryByText('task.dependencies.blockedAlert')
  ).not.toBeInTheDocument()
})

it('shows the empty state when there are no edges', () => {
  renderSection([])
  // formatMessage({ id: 'task.dependencies.empty' }) with no values → returns the key id
  expect(screen.getByText('task.dependencies.empty')).toBeInTheDocument()
})
