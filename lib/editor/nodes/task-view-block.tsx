import { useIntl } from 'react-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { useWorkspaceTasks } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks'
import { useWorkspaceTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus'
import { useProjects } from '@/app/workspace/[workspaceUrl]/hooks/useProjects'
import { useWorkspaceMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones'
import { statusLabel } from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import { parseTaskViewConfig, type TaskViewConfig } from './task-view-config'
import { TaskViewConfigPanel } from './task-view-config-panel'
import { TaskViewKanban } from './task-view-kanban'
import { groupTasks } from './task-view-group'

export function TaskViewBlock({
  node,
  editor,
  updateAttributes,
}: NodeViewProps) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const config = (node.attrs.config ??
    parseTaskViewConfig(null)) as TaskViewConfig
  const { tasks, truncated, loading, error, refetch } = useWorkspaceTasks(
    config.filters
  )
  const { updateStatus } = useWorkspaceTaskStatus(config.filters)
  const { projects } = useProjects()
  const { milestones } = useWorkspaceMilestones()

  const projectNames: Record<string, string> = {}
  for (const p of projects) projectNames[p.id] = p.name
  const milestoneNames: Record<string, string> = {}
  for (const m of milestones) milestoneNames[m.id] = m.name

  const groups = groupTasks(
    tasks,
    config.groupBy,
    projectNames,
    milestoneNames,
    intl.formatMessage({
      id: 'editor.taskView.ungrouped',
      defaultMessage: 'No group',
    }),
    s => statusLabel(intl, s)
  )

  return (
    <NodeViewWrapper
      className='task-view-block'
      data-task-view=''
      contentEditable={false}
    >
      <div className='task-view-block-header flex items-center justify-between text-muted-foreground'>
        <span>
          {intl.formatMessage({
            id: 'editor.taskView.heading',
            defaultMessage: 'Task View',
          })}
        </span>
        <div className='flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
            contentEditable={false}
            onMouseDown={e => e.preventDefault()}
            onClick={() => void refetch()}
            aria-label={intl.formatMessage({
              id: 'editor.taskView.refresh',
              defaultMessage: 'Refresh',
            })}
          >
            <RefreshCw size={13} />
          </Button>
          {editor.isEditable ? (
            <TaskViewConfigPanel
              config={config}
              onChange={c => updateAttributes({ config: c })}
            />
          ) : null}
        </div>
      </div>
      {loading ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({
            id: 'editor.taskView.loading',
            defaultMessage: 'Loading tasks…',
          })}
        </p>
      ) : error ? (
        <p className='text-danger-text'>
          {intl.formatMessage({
            id: 'editor.taskView.error',
            defaultMessage: 'Could not load tasks.',
          })}
        </p>
      ) : tasks.length === 0 ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({
            id: 'editor.taskView.empty',
            defaultMessage: 'No tasks match these filters.',
          })}
        </p>
      ) : (
        <div className='task-view-block-body space-y-2'>
          {truncated ? (
            <p className='task-view-truncated text-xs text-muted-foreground'>
              {intl.formatMessage(
                {
                  id: 'editor.taskView.truncated',
                  defaultMessage: 'Showing the first {count} tasks.',
                },
                { count: tasks.length }
              )}
            </p>
          ) : null}
          {config.view === 'kanban' ? (
            <TaskViewKanban
              tasks={tasks}
              workspaceUrl={workspaceUrl}
              editable={editor.isEditable}
              onStatusChange={updateStatus}
            />
          ) : (
            <div className='task-view-block-groups space-y-3'>
              {groups.map(group => (
                <div key={group.key} className='task-view-group'>
                  {group.label ? (
                    <p className='task-view-group-header text-xs font-medium text-muted-foreground'>
                      {group.label} · {group.tasks.length}
                    </p>
                  ) : null}
                  <ul className='task-view-block-list'>
                    {group.tasks.map(task => (
                      <li key={task.id}>
                        <Link
                          href={`/workspace/${workspaceUrl}/my-tasks/${task.teamIdentifier}-${task.number}`}
                          className='task-view-row'
                        >
                          <span className='task-view-row-id text-muted-foreground'>
                            {task.teamIdentifier}-{task.number}
                          </span>
                          <span className='task-view-row-title text-foreground'>
                            {task.title}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}
