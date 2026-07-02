/** @jest-environment jsdom */
const en: Record<string, string> = {
  'sprints.teamSelector.placeholder': 'Select team',
  'sprints.teamSelector.disabled': '(disabled)',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { TeamSelector } from '@/app/workspace/[workspaceUrl]/sprints/components/TeamSelector'
import type { ApiTeam } from '@/lib/api-client'

const team = (id: string, name: string): ApiTeam => ({
  id,
  name,
  identifier: id.toUpperCase(),
  isDefault: false,
  sprintsEnabled: true,
  sprintDurationDays: 14,
  sprintCooldownDays: 0,
  sprintStartWeekday: 1,
  sprintAutoCreate: 0,
  sprintAutoAddCompleted: false,
})

describe('TeamSelector', () => {
  // The Select branch (>3 teams) shows a placeholder until a team is picked.
  const manyTeams = [
    team('a', 'Alpha'),
    team('b', 'Bravo'),
    team('c', 'Charlie'),
    team('d', 'Delta'),
  ]

  // LUM-197: the placeholder must come from react-intl, not a hardcoded
  // 'Select team' literal. If intl regressed, the raw message id would leak.
  it('renders the intl-translated placeholder when no team is selected', () => {
    render(<TeamSelector teams={manyTeams} value={null} onChange={jest.fn()} />)

    expect(screen.getByText('Select team')).toBeInTheDocument()
    expect(
      screen.queryByText('sprints.teamSelector.placeholder')
    ).not.toBeInTheDocument()
  })

  // LUM-197: the "(disabled)" tab suffix is also intl-driven, not a literal.
  it('renders the intl-translated disabled suffix in the tabs branch', () => {
    render(
      <TeamSelector
        teams={[
          team('a', 'Alpha'),
          { ...team('b', 'Bravo'), sprintsEnabled: false },
        ]}
        value='a'
        onChange={jest.fn()}
      />
    )

    expect(screen.getByText('(disabled)')).toBeInTheDocument()
    expect(
      screen.queryByText('sprints.teamSelector.disabled')
    ).not.toBeInTheDocument()
  })

  it('hides the selector when there is nothing to switch between', () => {
    const { container } = render(
      <TeamSelector
        teams={[team('a', 'Alpha')]}
        value='a'
        onChange={jest.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
