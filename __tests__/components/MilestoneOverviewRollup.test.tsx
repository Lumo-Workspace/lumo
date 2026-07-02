/** @jest-environment jsdom */

const MESSAGES: Record<string, string> = {
  'milestone.rollup.label': 'Milestone summary',
  'milestone.rollup.completion': 'Completion',
  'milestone.rollup.health': 'Health',
  'milestone.rollup.timespan': 'Time span',
  'milestone.rollup.keyOutcome': 'Key outcome',
  'milestone.rollup.noTasks': 'No tasks yet',
  'milestone.rollup.noDates': 'No dates set',
  'milestone.rollup.noOutcome': 'No retro summary yet',
  'milestone.progress': '{done}/{total} tasks',
  'milestone.health.on-track': 'On track',
  'milestone.field.description': 'Description',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (MESSAGES[id] ?? id).replace(/\{(\w+)\}/g, (_, k) =>
        String(values?.[k] ?? '')
      ),
  }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DescriptionEditorLazy',
  () => ({
    DescriptionEditor: () => (
      <div data-testid='description-editor'>description</div>
    ),
  })
)

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMentionSources', () => ({
  useMentionSources: () => [],
}))

import { render, screen } from '@testing-library/react'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'

const baseProps = {
  onUpdate: () => {},
  members: [],
  workspaceUrl: 'acme',
}

const fullMilestone = {
  id: 'm1',
  name: 'Optimistic UI',
  description: '<p>A very long wall of prose…</p>',
  startDate: '2026-06-03T00:00:00.000Z',
  targetDate: '2026-07-15T00:00:00.000Z',
  taskCounts: { TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 3 },
  health: 'on-track' as const,
  summaryTldr: 'Shipped optimistic updates across every board interaction',
}

const emptyMilestone = {
  id: 'm2',
  name: 'Empty',
  description: null,
  startDate: null,
  targetDate: null,
  taskCounts: { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
  health: null,
  summaryTldr: null,
}

test('renders completion health timespan and key outcome before the description', () => {
  render(<MilestoneOverviewTab milestone={fullMilestone} {...baseProps} />)

  // All four rollup stats are present with real values.
  expect(screen.getByText('Completion')).toBeTruthy()
  expect(screen.getByText(/3\/4 tasks/)).toBeTruthy()
  expect(screen.getByText('75%')).toBeTruthy()
  expect(screen.getByText('Health')).toBeTruthy()
  expect(screen.getByText('On track')).toBeTruthy()
  expect(screen.getByText('Time span')).toBeTruthy()
  expect(screen.getByText(/Jun 3, 2026/)).toBeTruthy()
  expect(screen.getByText(/Jul 15, 2026/)).toBeTruthy()
  expect(screen.getByText('Key outcome')).toBeTruthy()
  expect(
    screen.getByText(
      'Shipped optimistic updates across every board interaction'
    )
  ).toBeTruthy()

  // Decision-first: the rollup section renders before the description editor.
  const rollup = screen.getByRole('region', { name: 'Milestone summary' })
  const editor = screen.getByTestId('description-editor')
  expect(
    rollup.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

test('renders honest empty states for missing dates health and tldr', () => {
  render(<MilestoneOverviewTab milestone={emptyMilestone} {...baseProps} />)

  // Each stat shows an explicit placeholder — never hidden, never fabricated.
  expect(screen.getByText('No tasks yet')).toBeTruthy()
  expect(screen.getByText('No dates set')).toBeTruthy()
  expect(screen.getByText('No retro summary yet')).toBeTruthy()
  // Health with no light applies renders a neutral dash.
  expect(screen.getByText('—')).toBeTruthy()
  // No fabricated numbers anywhere in the rollup.
  const rollup = screen.getByRole('region', { name: 'Milestone summary' })
  expect(rollup.textContent).not.toMatch(/\d+%/)
})
