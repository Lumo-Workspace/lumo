'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { StatusIcon } from '@/app/workspace/[workspaceUrl]/components/StatusIcon'
import {
  API_STATUS_LABEL,
  boardStatuses,
} from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import type { ApiStatus, ApiTask } from '@/app/workspace/[workspaceUrl]/types'
import { sortColumnTasks, statusFromDropTarget } from './task-view-kanban-drop'

interface TaskViewKanbanProps {
  tasks: ApiTask[]
  workspaceUrl: string
  editable: boolean

  onStatusChange: (id: string, status: ApiStatus) => void
}

function KanbanCard({
  task,
  workspaceUrl,
  editable,
}: {
  task: ApiTask
  workspaceUrl: string
  editable: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
    disabled: !editable,
  })
  return (
    <div
      ref={setNodeRef}
      className={`task-view-kanban-card rounded-md border border-border bg-background p-2 text-sm ${
        isDragging ? 'opacity-50' : ''
      }`}
      {...(editable ? { ...listeners, ...attributes } : {})}
    >
      <Link
        href={`/workspace/${workspaceUrl}/my-tasks/${task.teamIdentifier}-${task.number}`}
        className='task-view-kanban-card-link'
      >
        <span className='text-muted-foreground'>
          {task.teamIdentifier}-{task.number}
        </span>{' '}
        <span className='text-foreground'>{task.title}</span>
      </Link>
    </div>
  )
}

function KanbanColumn({
  status,
  label,
  tasks,
  workspaceUrl,
  editable,
}: {
  status: ApiStatus
  label: string
  tasks: ApiTask[]
  workspaceUrl: string
  editable: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={`task-view-kanban-column min-w-40 flex-1 space-y-1 rounded-md p-2 ${
        isOver ? 'bg-muted' : ''
      }`}
    >
      <div className='task-view-kanban-column-header flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
        <StatusIcon status={status} size={13} />
        <span>{label}</span>
        <span>{tasks.length}</span>
      </div>
      {tasks.map(task => (
        <KanbanCard
          key={task.id}
          task={task}
          workspaceUrl={workspaceUrl}
          editable={editable}
        />
      ))}
    </div>
  )
}

/**
 * Status kanban for the task-view block. Cards are draggable only in editable
 * mode; dropping on a different column calls `onStatusChange` (the block wires
 * that to the optimistic mutation). Always grouped by status (4 fixed columns,
 * plus Backlog while any task is in it — LUM-1057),
 * independent of `config.groupBy`.
 */
export function TaskViewKanban({
  tasks,
  workspaceUrl,
  editable,
  onStatusChange,
}: TaskViewKanbanProps) {
  const intl = useIntl()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard a11y: Space to pick up, arrows to move, Space to drop. dnd-kit
    // also emits ARIA live-region announcements for the drag.
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id
    const current = (event.active.data.current?.status ?? '') as string
    const next = statusFromDropTarget(
      typeof overId === 'string' ? overId : null,
      current
    )
    if (next) onStatusChange(String(event.active.id), next)
  }

  const columns = boardStatuses(tasks).map(status => ({
    status,
    label: API_STATUS_LABEL[status] ?? status,
    tasks: sortColumnTasks(tasks.filter(t => t.status === status)),
  }))

  return (
    <DndContext
      sensors={sensors}
      {...(editable ? { onDragEnd: handleDragEnd } : {})}
    >
      <div
        className='task-view-kanban flex gap-2 overflow-x-auto'
        aria-label={intl.formatMessage({
          id: 'editor.taskView.kanbanLabel',
          defaultMessage: 'Task board',
        })}
      >
        {columns.map(col => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={col.tasks}
            workspaceUrl={workspaceUrl}
            editable={editable}
          />
        ))}
      </div>
    </DndContext>
  )
}
