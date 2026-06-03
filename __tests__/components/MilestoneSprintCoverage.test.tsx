/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { MilestoneSprintCoverage } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage'

// Match the repo convention: component tests mock react-intl rather than
// transpiling its ESM. Resolve ids through the real en.json and interpolate
// {placeholders} so assertions on real English strings remain meaningful.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, unknown>
    ) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      const template = messages[descriptor.id] ?? descriptor.id
      return values
        ? template.replace(/\{(\w+)\}/g, (_m, k) =>
            k in values ? String(values[k]) : `{${k}}`
          )
        : template
    },
  }),
}))

type Coverage = NonNullable<
  import('@/lib/api-client/milestones').ApiMilestone['sprintCoverage']
>

function renderWith(coverage: Coverage | null) {
  return render(<MilestoneSprintCoverage coverage={coverage} />)
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
