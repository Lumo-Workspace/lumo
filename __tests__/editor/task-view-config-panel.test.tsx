jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({
      defaultMessage,
      id,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [{ id: 'p1', name: 'Acme' }] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTags', () => ({
  useTags: () => ({ tags: [{ id: 't1', name: 'bug', color: null }] }),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones',
  () => ({
    useWorkspaceMilestones: () => ({ milestones: [{ id: 'm1', name: 'V1' }] }),
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({
    members: [{ actorId: 'a1', name: 'Sam' }],
    fetchMembers: jest.fn(),
    agentActors: [],
  }),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskViewConfigPanel } from '@/lib/editor/nodes/task-view-config-panel'
import { DEFAULT_TASK_VIEW_CONFIG } from '@/lib/editor/nodes/task-view-config'

it('emits an updated config when a status filter is toggled', async () => {
  const onChange = jest.fn()
  render(
    <TaskViewConfigPanel
      config={DEFAULT_TASK_VIEW_CONFIG}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /configure/i }))
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'status.inProgress' })
  )
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: expect.objectContaining({ statuses: ['IN_PROGRESS'] }),
    })
  )
})

it('emits groupBy change', async () => {
  const onChange = jest.fn()
  render(
    <TaskViewConfigPanel
      config={DEFAULT_TASK_VIEW_CONFIG}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /configure/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Status' }))
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ groupBy: 'status' })
  )
})

it('emits a view change to kanban', async () => {
  const onChange = jest.fn()
  render(
    <TaskViewConfigPanel
      config={DEFAULT_TASK_VIEW_CONFIG}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /configure/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Kanban' }))
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ view: 'kanban' })
  )
})
