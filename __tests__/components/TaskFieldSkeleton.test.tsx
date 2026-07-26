/** @jest-environment jsdom */

// LUM-191: while a bound Sprint/Milestone field's name can't be resolved yet
// (neither the loaded option list nor the LUM-189 SSR-prefetched fallback) and
// the option list is still loading, the field renders a fixed-size skeleton
// instead of the placeholder — which would otherwise pop the name in and shift
// the layout once the list arrives. When a prefetched name IS available the
// name shows immediately (LUM-189) and no skeleton is rendered.

const en: Record<string, string> = {
  'task.field.milestone': 'Milestone',
  'task.field.milestone.none': 'No milestone',
  'sprints.taskField.noSprint': 'No sprint',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const mockUseMilestones = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestones', () => ({
  useMilestones: (...args: unknown[]) => mockUseMilestones(...args),
}))

const mockUseSprintsForTeam = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintsForTeam: (...args: unknown[]) => mockUseSprintsForTeam(...args),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtDate: () => '' }),
}))

import { render } from '@testing-library/react'
import { TaskMilestoneField } from '@/app/workspace/[workspaceUrl]/components/milestones/TaskMilestoneField'
import { TaskSprintField } from '@/app/workspace/[workspaceUrl]/sprints/components/TaskSprintField'

function skeleton(container: HTMLElement) {
  return container.querySelector('[data-slot="skeleton"]')
}
function trigger(container: HTMLElement) {
  return container.querySelector('[role="combobox"]')
}

beforeEach(() => {
  mockUseMilestones.mockReset()
  mockUseSprintsForTeam.mockReset()
})

describe('TaskMilestoneField skeleton', () => {
  it('renders a skeleton when a bound milestone has no resolvable name yet', () => {
    mockUseMilestones.mockReturnValue({ milestones: [], loading: true })
    const { container } = render(
      <TaskMilestoneField projectId='p-1' value='m-1' onChange={() => {}} />
    )
    expect(skeleton(container)).toBeTruthy()
    expect(trigger(container)).toBeNull()
  })

  it('shows the prefetched name (no skeleton) even while loading', () => {
    mockUseMilestones.mockReturnValue({ milestones: [], loading: true })
    const { container } = render(
      <TaskMilestoneField
        projectId='p-1'
        value='m-1'
        milestone={{ id: 'm-1', name: 'Q3' }}
        onChange={() => {}}
      />
    )
    expect(skeleton(container)).toBeNull()
    expect(trigger(container)).toBeTruthy()
    expect(container.textContent).toContain('Q3')
  })

  it('renders the select once milestones have loaded', () => {
    mockUseMilestones.mockReturnValue({
      milestones: [
        { id: 'm-1', name: 'Q3', status: 'ACTIVE', targetDate: null },
      ],
      loading: false,
    })
    const { container } = render(
      <TaskMilestoneField projectId='p-1' value='m-1' onChange={() => {}} />
    )
    expect(skeleton(container)).toBeNull()
    expect(trigger(container)).toBeTruthy()
  })

  it('does not show a skeleton for an unbound field even while loading', () => {
    mockUseMilestones.mockReturnValue({ milestones: [], loading: true })
    const { container } = render(
      <TaskMilestoneField projectId='p-1' value={null} onChange={() => {}} />
    )
    expect(skeleton(container)).toBeNull()
    expect(trigger(container)).toBeTruthy()
  })
})

describe('TaskSprintField skeleton', () => {
  const boundNoPrefetch = {
    id: 't-1',
    teamId: 'team-1',
    sprintId: 's-1',
    sprint: null,
  }

  it('renders a skeleton when a bound sprint has no resolvable name yet', () => {
    mockUseSprintsForTeam.mockReturnValue({ sprints: [], isLoading: true })
    const { container } = render(
      <TaskSprintField task={boundNoPrefetch} onChange={() => {}} />
    )
    expect(skeleton(container)).toBeTruthy()
    expect(trigger(container)).toBeNull()
  })

  it('shows the prefetched name (no skeleton) even while loading', () => {
    mockUseSprintsForTeam.mockReturnValue({ sprints: [], isLoading: true })
    const { container } = render(
      <TaskSprintField
        task={{
          ...boundNoPrefetch,
          sprint: { id: 's-1', name: 'Sprint 1' },
        }}
        onChange={() => {}}
      />
    )
    expect(skeleton(container)).toBeNull()
    expect(trigger(container)).toBeTruthy()
    expect(container.textContent).toContain('Sprint 1')
  })

  it('renders the select once sprints have loaded', () => {
    mockUseSprintsForTeam.mockReturnValue({ sprints: [], isLoading: false })
    const { container } = render(
      <TaskSprintField task={boundNoPrefetch} onChange={() => {}} />
    )
    expect(skeleton(container)).toBeNull()
    expect(trigger(container)).toBeTruthy()
  })

  it('does not show a skeleton for a sprint-less task even while loading', () => {
    mockUseSprintsForTeam.mockReturnValue({ sprints: [], isLoading: true })
    const { container } = render(
      <TaskSprintField
        task={{ ...boundNoPrefetch, sprintId: null }}
        onChange={() => {}}
      />
    )
    expect(skeleton(container)).toBeNull()
    expect(trigger(container)).toBeTruthy()
  })
})
