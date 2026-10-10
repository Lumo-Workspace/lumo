/** @jest-environment jsdom */
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

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  PointerSensor: class PointerSensor {},
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}))

import { render, screen } from '@testing-library/react'
import { TaskViewKanban } from '@/lib/editor/nodes/task-view-kanban'

const tasks = [
  {
    id: 't1',
    title: 'Alpha',
    teamIdentifier: 'LUM',
    number: 1,
    status: 'TODO',
  },
  { id: 't2', title: 'Beta', teamIdentifier: 'LUM', number: 2, status: 'DONE' },
] as any[]

it('renders the four status columns and places cards by status', () => {
  render(
    <TaskViewKanban
      tasks={tasks}
      workspaceUrl='acme'
      editable={false}
      onStatusChange={jest.fn()}
    />
  )
  expect(screen.getByText('status.todo')).toBeInTheDocument()
  expect(screen.getByText('status.inProgress')).toBeInTheDocument()
  expect(screen.getByText('status.inReview')).toBeInTheDocument()
  expect(screen.getByText('status.done')).toBeInTheDocument()
  expect(screen.getByText('Alpha')).toBeInTheDocument()
  expect(screen.getByText('Beta')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Alpha/ })).toHaveAttribute(
    'href',
    '/workspace/acme/my-tasks/LUM-1'
  )
})
