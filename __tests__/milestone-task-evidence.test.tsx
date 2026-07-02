/** @jest-environment jsdom */

// LUM-636 — the task evidence grid: one card per member task with ref,
// status, claim (or an explicit no-claim placeholder), rejection signals,
// and the evidence link; status pills filter client-side and the group
// control reuses the LUM-628 segment rollup.

const messages: Record<string, string> = {
  'status.done': 'Done',
  'status.inProgress': 'In Progress',
  'milestone.taskEvidence.title': 'Task evidence',
  'milestone.taskEvidence.filterAll': 'All {count}',
  'milestone.taskEvidence.evidence': 'Evidence',
  'milestone.taskEvidence.groupNone': 'No grouping',
  'milestone.segments.dimension.sprint': 'By sprint',
  'milestone.segments.count': '{done}/{total} done',
  'milestone.segments.noSprint': 'No sprint',
  'milestone.outcome.claims.noClaim': 'No recorded claim for this delivery',
  'milestone.outcome.claims.source.AGENT': 'self-reported',
  'milestone.outcome.fate.kind.REVERTED': 'reverted',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MilestoneTaskEvidenceSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTaskEvidenceSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

const segments = {
  tasks: [
    { taskId: 't1', ref: 'LUM-1', title: 'Shipped thing', status: 'DONE' },
    { taskId: 't2', ref: 'LUM-2', title: 'Open thing', status: 'IN_PROGRESS' },
    { taskId: 't3', ref: 'LUM-3', title: 'Reverted thing', status: 'DONE' },
  ],
  sprint: [
    { key: 's6', label: 'Sprint 6', taskIds: ['t1', 't2'], doneCount: 1 },
    { key: 'NONE', label: null, taskIds: ['t3'], doneCount: 1 },
  ],
  priority: [
    {
      key: 'MEDIUM',
      label: null,
      taskIds: ['t1', 't2', 't3'],
      doneCount: 2,
    },
  ],
  workstream: [
    { key: 'NONE', label: null, taskIds: ['t1', 't2', 't3'], doneCount: 2 },
  ],
} as unknown as NonNullable<ApiMilestone['segments']>

const outcome = {
  claims: [
    {
      taskId: 't1',
      ref: 'LUM-1',
      title: 'Shipped thing',
      claim: 'shipped the rollup with fail-closed buckets',
      source: 'AGENT',
    },
    {
      taskId: 't3',
      ref: 'LUM-3',
      title: 'Reverted thing',
      claim: null,
      source: null,
    },
  ],
  fate: {
    doneCount: 2,
    rejected: [
      {
        taskId: 't3',
        ref: 'LUM-3',
        title: 'Reverted thing',
        kinds: [{ kind: 'REVERTED', count: 1 }],
      },
    ],
    inconclusiveCount: 1,
  },
} as unknown as NonNullable<ApiMilestone['outcome']>

function setup() {
  return render(
    <MilestoneTaskEvidenceSection
      segments={segments}
      outcome={outcome}
      workspaceUrl='acme'
    />
  )
}

test('task evidence cards render claim or explicit placeholder and filter by status', () => {
  setup()

  // Every task gets a card: ref + status + title.
  expect(screen.getByText('LUM-1')).toBeInTheDocument()
  expect(screen.getByText('LUM-2')).toBeInTheDocument()
  expect(screen.getByText('LUM-3')).toBeInTheDocument()

  // DONE task with a frozen claim: claim text + provenance label.
  expect(
    screen.getByText('shipped the rollup with fail-closed buckets')
  ).toBeInTheDocument()
  expect(screen.getByText('self-reported')).toBeInTheDocument()

  // Claim-less cards state so explicitly — never hidden, never fabricated
  // (the in-progress task and the claim-less DONE task both read it).
  expect(
    screen.getAllByText('No recorded claim for this delivery')
  ).toHaveLength(2)

  // Post-delivery rejection signals surface on the card.
  expect(screen.getByText('reverted')).toBeInTheDocument()

  // Evidence links target the task detail pages.
  const links = screen.getAllByRole('link', { name: /Evidence/ })
  expect(links.map(l => l.getAttribute('href'))).toEqual([
    '/workspace/acme/my-tasks/LUM-1',
    '/workspace/acme/my-tasks/LUM-2',
    '/workspace/acme/my-tasks/LUM-3',
  ])

  // Status pills filter client-side.
  fireEvent.click(screen.getByRole('button', { name: 'In Progress 1' }))
  expect(screen.queryByText('LUM-1')).toBeNull()
  expect(screen.getByText('LUM-2')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Done 2' }))
  expect(screen.getByText('LUM-1')).toBeInTheDocument()
  expect(screen.queryByText('LUM-2')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'All 3' }))
  expect(screen.getByText('LUM-2')).toBeInTheDocument()
})

test('grouping reuses the segment rollup including explicit NONE buckets', () => {
  setup()

  fireEvent.click(screen.getByRole('button', { name: 'By sprint' }))
  // Segment headers with done/total counts; the NONE bucket is explicit.
  expect(screen.getByText('Sprint 6')).toBeInTheDocument()
  expect(screen.getByText('1/2 done')).toBeInTheDocument()
  expect(screen.getByText('No sprint')).toBeInTheDocument()

  // Status filter composes with grouping; empty groups disappear.
  fireEvent.click(screen.getByRole('button', { name: 'In Progress 1' }))
  expect(screen.getByText('Sprint 6')).toBeInTheDocument()
  expect(screen.queryByText('No sprint')).toBeNull()
})

test('renders nothing without the segments enrichment (older server)', () => {
  const { container } = render(
    <MilestoneTaskEvidenceSection
      segments={null}
      outcome={outcome}
      workspaceUrl='acme'
    />
  )
  expect(container.firstChild).toBeNull()
})
