/** @jest-environment jsdom */
// LUM-1274: the task property panel is three sentence-case sections
// (Properties · Planning · Relations) separated by Separators, with every
// select rendered in its `ghost` variant and no className overrides.
const en: Record<string, string> = {
  'task.properties': 'Properties',
  'task.section.planning': 'Planning',
  'task.section.relations': 'Relations',
  'task.status': 'Status',
  'task.priority': 'Priority',
  'task.assignee': 'Assignee',
  'task.createdBy': 'Creator',
  'common.project': 'Project',
  'sprints.taskField.label': 'Sprint',
  'task.field.milestone': 'Milestone',
  'task.dependencies.field.label': 'Deps',
  'task.tags': 'Tags',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const mockRecordProps = jest.fn()
function stub(name: string) {
  function FieldStub(props: Record<string, unknown>) {
    mockRecordProps(name, props)
    return <span data-testid={`field-${name}`} />
  }
  return FieldStub
}
jest.mock('@/app/workspace/[workspaceUrl]/components/fields', () => ({
  StatusSelect: stub('status'),
  PrioritySelect: stub('priority'),
  AssigneeSelect: stub('assignee'),
  ProjectSelect: stub('project'),
  CreatorField: stub('creator'),
  resolveCreatorDisplay: jest.requireActual(
    '@/app/workspace/[workspaceUrl]/components/fields/creator-display'
  ).resolveCreatorDisplay,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/TaskSprintField',
  () => ({ TaskSprintField: stub('sprint') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/TaskMilestoneField',
  () => ({ TaskMilestoneField: stub('milestone') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDependencyField',
  () => ({ TaskDependencyField: stub('deps') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/TagPicker',
  () => ({
    TagPicker: stub('tags'),
  })
)

import { render, screen } from '@testing-library/react'
import { TaskDetailSidebar } from '@/app/workspace/[workspaceUrl]/components/TaskDetailSidebar'

const task: any = {
  id: 't1',
  title: 'x',
  status: 'TODO',
  priority: 'HIGH',
  projectId: 'p1',
  project: { id: 'p1', name: 'Lumo' },
  assigneeActorId: null,
  assignee: null,
  description: null,
  updatedAt: '2026-10-19T00:00:00Z',
  number: 1,
  teamIdentifier: 'LUM',
  teamId: 'team1',
  sprintsEnabled: true,
  tags: [],
}

function renderPanel(
  overrides: Record<string, unknown> = {},
  members: any[] = []
) {
  return render(
    <TaskDetailSidebar
      task={{ ...task, ...overrides }}
      members={members}
      agentActors={[]}
      projects={[]}
      workspaceUrl='acme'
      onPatch={jest.fn()}
      allTags={[]}
      onTagsChange={jest.fn()}
    />
  )
}

describe('TaskDetailSidebar sections (LUM-1274)', () => {
  it('groups rows into Properties, Planning and Relations with separators', () => {
    const { container } = renderPanel()
    const headings = screen.getAllByRole('heading').map(h => h.textContent)
    expect(headings).toEqual(['Properties', 'Planning', 'Relations'])
    expect(
      container.querySelectorAll('[data-slot="separator"], [role="none"]')
        .length
    ).toBeGreaterThanOrEqual(2)

    const sections = container.querySelectorAll('section')
    const labels = (i: number) =>
      Array.from(sections[i]!.querySelectorAll('span.truncate')).map(
        s => s.textContent
      )
    expect(labels(0)).toEqual(['Status', 'Priority', 'Assignee', 'Creator'])
    expect(labels(1)).toEqual(['Project', 'Sprint', 'Milestone'])
    expect(labels(2)).toEqual(['Deps', 'Tags'])
  })

  it('renders every select in its ghost variant without className overrides', () => {
    renderPanel()
    for (const name of [
      'status',
      'priority',
      'assignee',
      'project',
      'sprint',
      'milestone',
    ]) {
      const call = mockRecordProps.mock.calls.find(([n]) => n === name)
      const props = call?.[1] as Record<string, unknown> | undefined
      expect(props?.variant).toBe('ghost')
      expect(props?.triggerClassName).toBeUndefined()
    }
  })

  it('shows the creating member read-only under Properties (LUM-1283)', () => {
    renderPanel({ createdBy: { id: 'wm-a', clerkId: 'user_a' } }, [
      {
        id: 'wm-a',
        clerkId: 'user_a',
        role: 'MEMBER',
        name: 'Alice',
        email: 'a@example.com',
        imageUrl: null,
        joinedAt: '2026-01-01T00:00:00Z',
        actorId: 'actor-a',
      },
    ])
    const call = mockRecordProps.mock.calls
      .filter(([n]) => n === 'creator')
      .pop()
    expect(call?.[1]).toEqual({
      creator: { kind: 'member', name: 'Alice', imageUrl: null },
    })
  })

  it('shows an unrecorded creator when the task has none (LUM-1283)', () => {
    renderPanel({ createdBy: null })
    const call = mockRecordProps.mock.calls
      .filter(([n]) => n === 'creator')
      .pop()
    expect(call?.[1]).toEqual({ creator: { kind: 'unrecorded' } })
  })

  it('omits the Sprint row when the team has sprints disabled', () => {
    renderPanel({ sprintsEnabled: false })
    expect(screen.queryByText('Sprint')).toBeNull()
    expect(screen.getByText('Milestone')).toBeInTheDocument()
  })
})
