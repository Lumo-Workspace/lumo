/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.edit': 'Edit milestone',
  'milestone.delete': 'Delete milestone',
  'milestone.actions': 'Milestone actions',
  'milestone.archive': 'Archive',
  'milestone.unarchive': 'Unarchive',
  'milestone.archived': 'Archived',
  'milestone.status.ACTIVE': 'Active',
  'milestone.progress': '{done}/{total} tasks',
  'milestone.targetDate.none': 'No target date',
  'milestone.health.on-track': 'On track',
  'milestone.health.at-risk': 'At risk',
  'milestone.health.overdue': 'Overdue',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

import { render, screen } from '@testing-library/react'
import { MilestoneCard } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCard'
import type { ApiMilestone } from '@/lib/api-client'

function milestone(overrides: Partial<ApiMilestone> = {}): ApiMilestone {
  return {
    id: 'm-1',
    projectId: 'p-1',
    name: 'Q3 Launch',
    slug: 'q3-launch',
    description: null,
    status: 'ACTIVE',
    startDate: null,
    targetDate: '2026-08-31T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderCard(m: ApiMilestone) {
  return render(
    <MilestoneCard
      milestone={m}
      progress={{ done: 1, total: 3 }}
      workspaceUrl='acme'
      projectSlug='lumo'
      onEdit={() => {}}
      onDelete={() => {}}
      onArchive={() => {}}
      onUnarchive={() => {}}
    />
  )
}

describe('MilestoneCard health dot', () => {
  it('renders a single dot labelled with the health state', () => {
    renderCard(milestone({ health: 'at-risk' }))
    expect(screen.getByLabelText('At risk')).toBeInTheDocument()
  })

  it('renders no dot when there is no health light', () => {
    renderCard(milestone({ health: null }))
    expect(screen.queryByLabelText('On track')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('At risk')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Overdue')).not.toBeInTheDocument()
  })
})

describe('MilestoneCard archive state', () => {
  it('shows an Archived badge when the milestone is archived', () => {
    renderCard(milestone({ archivedAt: '2026-06-01T00:00:00.000Z' }))
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('shows no Archived badge for an active milestone', () => {
    renderCard(milestone({ archivedAt: null }))
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
  })

  it('labels the actions trigger for screen readers', () => {
    renderCard(milestone())
    expect(screen.getByLabelText('Milestone actions')).toBeInTheDocument()
  })
})
