// lib/editor/nodes/task-view-block.tsx
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useWorkspaceTasks } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks'
import { parseTaskViewConfig, type TaskViewConfig } from './task-view-config'

/**
 * Read-only render of the embedded task-view block. Reads the stored config,
 * fetches the live workspace task list, and renders loading / error / empty /
 * list states. Same component runs in the editor and the read-only viewer; it
 * is non-interactive in Phase 2 (config UI + grouping land in Phase 3).
 */
export function TaskViewBlock({ node }: NodeViewProps) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const config = (node.attrs.config ?? parseTaskViewConfig(null)) as TaskViewConfig
  const { tasks, loading, error } = useWorkspaceTasks(config.filters)

  return (
    <NodeViewWrapper
      className='task-view-block'
      data-task-view=''
      contentEditable={false}
    >
      <div className='task-view-block-header text-muted-foreground'>
        {intl.formatMessage({
          id: 'editor.taskView.heading',
          defaultMessage: 'Task View',
        })}
      </div>
      {loading ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({
            id: 'editor.taskView.loading',
            defaultMessage: 'Loading tasks…',
          })}
        </p>
      ) : error ? (
        <p className='text-destructive'>
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
        <ul className='task-view-block-list'>
          {tasks.map(task => (
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
      )}
    </NodeViewWrapper>
  )
}
