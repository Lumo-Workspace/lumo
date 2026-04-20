'use client'
import { useState, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { sprintsClient, tasksClient } from '@/lib/api-client'
import { useIntl } from 'react-intl'

interface BacklogTask {
  id: string
  title: string
  number: number
  teamIdentifier?: string // from task.team.identifier
  project?: { id: string; name: string } | null
}

export function PlanBacklogPanel({
  sprint,
  teamId,
  onAdded,
  reloadKey = 0,
}: {
  sprint: { id: string; name: string }
  teamId: string
  onAdded?: () => void
  /** Bump to force a re-fetch after an external add (e.g. drag-drop). */
  reloadKey?: number
}) {
  const intl = useIntl()
  const [tasks, setTasks] = useState<BacklogTask[] | undefined>(undefined)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await tasksClient.listByTeam<{ tasks: any[] }>(teamId, {
        sprintId: null,
      })
      setTasks(
        res.tasks.map(t => ({
          id: t.id,
          title: t.title,
          number: t.number,
          teamIdentifier: t.team?.identifier,
          project: t.project,
        }))
      )
    } catch (e: any) {
      setError(e.message ?? 'Failed to load backlog')
    }
  }

  useEffect(() => {
    void load()
    // `load` is a stable-enough local function; ESLint exhaustive-deps
    // can't see that we only want to re-run on teamId / reloadKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, reloadKey])

  async function add(taskId: string) {
    setBusyIds(prev => new Set(prev).add(taskId))
    try {
      await sprintsClient.addTask(sprint.id, taskId)
      setTasks(prev => prev?.filter(t => t.id !== taskId))
      onAdded?.()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusyIds(prev => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  return (
    <aside className='flex flex-col gap-2 border-l pl-4'>
      <header>
        <h3 className='font-semibold'>
          {intl.formatMessage({ id: 'sprints.plan.backlogTitle' })}
        </h3>
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'sprints.plan.backlogHint' },
            { sprintName: sprint.name }
          )}
        </p>
      </header>
      {error && <p className='text-destructive text-sm'>{error}</p>}
      <div className='flex flex-col divide-y rounded border max-h-[70vh] overflow-y-auto'>
        {tasks === undefined && (
          <p className='p-3 text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.plan.loading' })}
          </p>
        )}
        {tasks?.length === 0 && (
          <p className='p-3 text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.plan.empty' })}
          </p>
        )}
        {tasks?.map(t => (
          <BacklogRow
            key={t.id}
            task={t}
            busy={busyIds.has(t.id)}
            onAdd={() => add(t.id)}
          />
        ))}
      </div>
    </aside>
  )
}

function BacklogRow({
  task,
  busy,
  onAdd,
}: {
  task: BacklogTask
  busy: boolean
  onAdd: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `backlog:${task.id}`,
    data: { kind: 'backlog-task', taskId: task.id },
    disabled: busy,
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center justify-between gap-2 p-2 select-none ${
        isDragging
          ? 'opacity-40 cursor-grabbing'
          : busy
            ? 'cursor-wait'
            : 'cursor-grab'
      }`}
    >
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>
          {task.teamIdentifier}-{task.number}
          {task.project?.name && ` · ${task.project.name}`}
        </p>
        <p className='truncate text-sm'>{task.title}</p>
      </div>
      <Button
        size='sm'
        variant='ghost'
        disabled={busy}
        // Buttons inside a draggable need these listeners stopped so clicks
        // don't get swallowed by the drag sensor.
        onPointerDown={e => e.stopPropagation()}
        onClick={onAdd}
      >
        +
      </Button>
    </div>
  )
}
