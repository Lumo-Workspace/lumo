'use client'
import { useState, useEffect } from 'react'
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
}: {
  sprint: { id: string; name: string }
  teamId: string
  onAdded?: () => void
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
  }, [teamId])

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
          <div
            key={t.id}
            className='flex items-center justify-between gap-2 p-2'
          >
            <div className='min-w-0 flex-1'>
              <p className='text-xs text-muted-foreground'>
                {t.teamIdentifier}-{t.number}
                {t.project?.name && ` · ${t.project.name}`}
              </p>
              <p className='truncate text-sm'>{t.title}</p>
            </div>
            <Button
              size='sm'
              variant='ghost'
              disabled={busyIds.has(t.id)}
              onClick={() => add(t.id)}
            >
              +
            </Button>
          </div>
        ))}
      </div>
    </aside>
  )
}
