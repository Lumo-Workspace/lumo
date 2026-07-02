/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config. Mock it the same way other component tests in this project do.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      if (!values) return id
      return `${id} ${Object.entries(values)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')}`
    },
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneSegmentsSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSegmentsSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type Segments = NonNullable<ApiMilestone['segments']>

const segments: Segments = {
  tasks: [
    { taskId: 't1', ref: 'LUM-283', title: 'Bundle diet', status: 'DONE' },
    { taskId: 't2', ref: 'LUM-290', title: 'Board polish', status: 'TODO' },
  ],
  sprint: [
    { key: 's3', label: 'Sprint 3', taskIds: ['t1'], doneCount: 1 },
    { key: 'NONE', label: null, taskIds: ['t2'], doneCount: 0 },
  ],
  priority: [{ key: 'HIGH', label: null, taskIds: ['t1', 't2'], doneCount: 1 }],
  workstream: [
    { key: 'tag-a', label: 'perf', taskIds: ['t1'], doneCount: 1 },
    { key: 'NONE', label: null, taskIds: ['t2'], doneCount: 0 },
  ],
}

describe('MilestoneSegmentsSection', () => {
  it('renders nothing when the detail response carries no segments enrichment', () => {
    const { container } = render(
      <MilestoneSegmentsSection segments={null} workspaceUrl='acme' />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an explicit empty state when the milestone has no tasks', () => {
    render(
      <MilestoneSegmentsSection
        segments={{ tasks: [], sprint: [], priority: [], workstream: [] }}
        workspaceUrl='acme'
      />
    )
    expect(screen.getByText('milestone.segments.title')).toBeInTheDocument()
    expect(screen.getByText('milestone.segments.empty')).toBeInTheDocument()
  })

  it('defaults to the sprint dimension with per-segment done/total counts and a labeled NONE bucket', () => {
    render(<MilestoneSegmentsSection segments={segments} workspaceUrl='acme' />)
    expect(screen.getByText('Sprint 3')).toBeInTheDocument()
    expect(screen.getByText('milestone.segments.noSprint')).toBeInTheDocument()
    expect(
      screen.getByText('milestone.segments.count done=1 total=1')
    ).toBeInTheDocument()
  })

  it('expanding a segment reveals task rows that link to the task detail page (drill-down)', () => {
    render(<MilestoneSegmentsSection segments={segments} workspaceUrl='acme' />)
    // Collapsed: no drill-down rows yet.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Sprint 3/ }))
    const link = screen.getByRole('link', { name: /LUM-283/ })
    expect(link).toHaveAttribute('href', '/workspace/acme/my-tasks/LUM-283')
    expect(screen.getByText('Bundle diet')).toBeInTheDocument()
  })

  it('switches dimension between sprint / priority / workstream', () => {
    render(<MilestoneSegmentsSection segments={segments} workspaceUrl='acme' />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'milestone.segments.dimension.priority',
      })
    )
    // Priority segments label via the shared priority.* keys.
    expect(screen.getByText('priority.high')).toBeInTheDocument()
    expect(screen.queryByText('Sprint 3')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'milestone.segments.dimension.workstream',
      })
    )
    expect(screen.getByText('perf')).toBeInTheDocument()
    expect(
      screen.getByText('milestone.segments.noWorkstream')
    ).toBeInTheDocument()
  })
})
