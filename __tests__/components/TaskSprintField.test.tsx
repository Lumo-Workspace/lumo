/** @jest-environment jsdom */
const en: Record<string, string> = {
  'sprints.taskField.noSprint': 'No sprint',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

// First paint: the client sprint list hasn't loaded yet.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintsForTeam: () => ({ sprints: [] }),
}))

import { render, screen } from '@testing-library/react'
import { TaskSprintField } from '@/app/workspace/[workspaceUrl]/sprints/components/TaskSprintField'

describe('TaskSprintField', () => {
  // Regression guard for LUM-189: with the option list still empty, the
  // SSR-prefetched `sprint` object must drive the trigger name so it doesn't
  // flicker blank before `useSprintsForTeam` resolves.
  it('renders the prefetched sprint name when the option list is empty', () => {
    render(
      <TaskSprintField
        task={{
          id: 't_1',
          teamId: 'team_1',
          sprintId: 'sp_1',
          sprint: { id: 'sp_1', status: 'ACTIVE', name: 'Sprint 7' },
        }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByText('Sprint 7')).toBeInTheDocument()
    expect(screen.queryByText('No sprint')).not.toBeInTheDocument()
  })

  it('shows the placeholder when no sprint is bound', () => {
    render(
      <TaskSprintField
        task={{ id: 't_1', teamId: 'team_1', sprintId: null, sprint: null }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByText('No sprint')).toBeInTheDocument()
  })
})
