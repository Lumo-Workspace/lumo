/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import { MilestoneSprintCoverage } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage'

function renderWith(coverage: any) {
  return render(
    <IntlProvider locale='en' messages={en as Record<string, string>}>
      <MilestoneSprintCoverage coverage={coverage} />
    </IntlProvider>
  )
}

describe('MilestoneSprintCoverage', () => {
  it('renders a row per sprint with progress and the unsprinted count', () => {
    renderWith({
      sprints: [
        {
          sprintId: 's3',
          number: 3,
          name: 'Sprint 3',
          status: 'ACTIVE',
          taskCount: 6,
          doneCount: 4,
        },
      ],
      unsprinted: 2,
    })
    expect(screen.getByText('Sprint coverage')).toBeInTheDocument()
    expect(screen.getByText('Sprint 3')).toBeInTheDocument()
    expect(screen.getByText('4/6')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('2 unsprinted')).toBeInTheDocument()
  })

  it('renders the empty state when no sprints are covered', () => {
    renderWith({ sprints: [], unsprinted: 0 })
    expect(screen.getByText('No sprints covered')).toBeInTheDocument()
  })

  it('renders nothing when coverage is null', () => {
    const { container } = renderWith(null)
    expect(container).toBeEmptyDOMElement()
  })
})
