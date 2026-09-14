/** @jest-environment jsdom */
/**
 * LUM-723 — the milestone list is a table of one-line rows, not a card grid.
 * Each row carries exactly four readings: the delivery dot, the name, progress
 * (bar + done/total) and the target date. These tests pin the readings and the
 * two degradations the design calls for: a milestone archived while unfinished
 * greys out and gets tagged, and an overdue target date outranks delivery on
 * the dot (an "Active" label would bury the fact a scanner needs).
 */

const en: Record<string, string> = {
  'milestone.openActions': 'Milestone actions',
  'milestone.edit': 'Edit milestone',
  'milestone.delete': 'Delete milestone',
  'milestone.archive': 'Archive',
  'milestone.unarchive': 'Unarchive',
  'common.copyLink': 'Copy link',
  'milestone.state.active': 'Active',
  'milestone.state.completed': 'Completed',
  'milestone.state.archived': 'Archived',
  'milestone.health.at-risk': 'At risk',
  'milestone.health.overdue': 'Overdue',
  'milestone.health.on-track': 'On track',
  'milestone.list.incomplete': 'Incomplete',
  'milestone.list.archivedIncomplete': 'Archived while incomplete',
  'milestone.targetDate.none': 'No target date',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneRow } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneRow'
import type { ApiMilestone } from '@/lib/api-client'

function milestone(overrides: Partial<ApiMilestone> = {}): ApiMilestone {
  return {
    id: 'm-1',
    projectId: 'p-1',
    name: 'Q3 Launch',
    slug: 'q3-launch',
    description: null,
    startDate: null,
    targetDate: '2026-08-31T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderRow(m: ApiMilestone, progress = { done: 2, total: 8 }) {
  return render(
    <MilestoneRow
      milestone={m}
      progress={progress}
      href='/workspace/acme/projects/lumo/milestones/q3-launch'
      onEdit={() => {}}
      onArchiveToggle={() => {}}
      onCopyLink={() => {}}
      onDelete={() => {}}
    />
  )
}

describe('MilestoneRow', () => {
  it('renders the delivery dot, title, progress and target date in one row', () => {
    const { container } = renderRow(milestone())

    // The dot announces what it encodes rather than being colour-only.
    expect(screen.getByLabelText('Active')).toBeInTheDocument()

    // The name is the row-wide link to the milestone.
    const link = screen.getByRole('link', { name: 'Q3 Launch' })
    expect(link).toHaveAttribute(
      'href',
      '/workspace/acme/projects/lumo/milestones/q3-launch'
    )

    expect(screen.getByText('2/8')).toBeInTheDocument()
    // 2 of 8 done — the bar is filled to the same fraction the count states.
    const bar = container.querySelector('[style*="width"]')
    expect(bar).toHaveStyle({ width: '25%' })

    expect(screen.getByText('Aug 31, 2026')).toBeInTheDocument()

    // One line: the row is a single flex track, not a stacked card.
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('says so instead of leaving the date column blank when no target date is set', () => {
    renderRow(milestone({ targetDate: null }))
    expect(screen.getByText('No target date')).toBeInTheDocument()
  })

  it('greys out and tags a milestone archived before its tasks landed', () => {
    renderRow(milestone({ archivedAt: '2026-07-01T00:00:00.000Z' }), {
      done: 3,
      total: 9,
    })

    expect(screen.getByText('Incomplete')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Archived while incomplete')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Q3 Launch' })).toHaveClass(
      'text-muted-foreground'
    )
  })

  it('carries no incomplete tag when an archived milestone did finish its tasks', () => {
    renderRow(
      milestone({
        completedAt: '2026-06-01T00:00:00.000Z',
        archivedAt: '2026-07-01T00:00:00.000Z',
      }),
      { done: 6, total: 6 }
    )

    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Completed')).toBeInTheDocument()
  })

  it('lets an overdue target date outrank delivery on the dot', () => {
    renderRow(milestone({ health: 'overdue' }))

    expect(screen.getByLabelText('Overdue')).toBeInTheDocument()
    expect(screen.queryByLabelText('Active')).not.toBeInTheDocument()
  })

  it('exposes the row actions menu', () => {
    renderRow(milestone())
    expect(screen.getByLabelText('Milestone actions')).toBeInTheDocument()
  })

  it('offers edit, archive, copy link and delete from the row menu', async () => {
    const user = userEvent.setup()
    const onCopyLink = jest.fn()
    render(
      <MilestoneRow
        milestone={milestone()}
        progress={{ done: 2, total: 8 }}
        href='/workspace/acme/projects/lumo/milestones/q3-launch'
        onEdit={() => {}}
        onArchiveToggle={() => {}}
        onCopyLink={onCopyLink}
        onDelete={() => {}}
      />
    )

    await user.click(screen.getByLabelText('Milestone actions'))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual([
      'Edit milestone',
      'Archive',
      'Copy link',
      'Delete milestone',
    ])

    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    expect(onCopyLink).toHaveBeenCalledTimes(1)
  })
})
