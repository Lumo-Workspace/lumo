'use client'

import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { TimelineActivityEntry, WorkspaceMemberInfo } from '../../../types'

interface CompactActivityItemProps {
  entry: TimelineActivityEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

function resolveActorName(
  entry: TimelineActivityEntry,
  members: WorkspaceMemberInfo[],
  _agentActors: { actorId: string; name: string }[]
): string {
  if (!entry.actorId) return 'System'
  if (entry.actor?.type === 'AGENT') {
    return entry.actor.agent?.name ?? 'Agent'
  }
  const member = members.find(m => m.actorId === entry.actorId)
  return member?.name ?? 'Unknown'
}

function formatActivityText(
  type: string,
  payload: Record<string, unknown> | null,
  intl: ReturnType<typeof useIntl>
): string {
  const p = payload ?? {}
  switch (type) {
    case 'TASK_CREATED':
      return intl.formatMessage({
        id: 'activity.taskCreated',
        defaultMessage: 'created this task',
      })
    case 'STATUS_CHANGED':
      return intl.formatMessage(
        {
          id: 'activity.statusChanged',
          defaultMessage: 'changed status from {from} to {to}',
        },
        { from: String(p.from ?? ''), to: String(p.to ?? '') }
      )
    case 'PRIORITY_CHANGED':
      return intl.formatMessage(
        {
          id: 'activity.priorityChanged',
          defaultMessage: 'changed priority from {from} to {to}',
        },
        { from: String(p.from ?? ''), to: String(p.to ?? '') }
      )
    case 'ASSIGNEE_CHANGED':
      return p.toName
        ? intl.formatMessage(
            {
              id: 'activity.assigneeChanged',
              defaultMessage: 'assigned to {name}',
            },
            { name: String(p.toName) }
          )
        : intl.formatMessage({
            id: 'activity.assigneeRemoved',
            defaultMessage: 'removed assignee',
          })
    case 'REVIEWER_CHANGED':
      return p.toName
        ? intl.formatMessage(
            {
              id: 'activity.reviewerChanged',
              defaultMessage: 'set reviewer to {name}',
            },
            { name: String(p.toName) }
          )
        : intl.formatMessage({
            id: 'activity.reviewerRemoved',
            defaultMessage: 'removed reviewer',
          })
    case 'TITLE_CHANGED':
      return intl.formatMessage({
        id: 'activity.titleChanged',
        defaultMessage: 'changed title',
      })
    case 'DESCRIPTION_CHANGED':
      return intl.formatMessage({
        id: 'activity.descriptionChanged',
        defaultMessage: 'updated description',
      })
    case 'DUE_DATE_CHANGED':
      return p.to
        ? intl.formatMessage(
            {
              id: 'activity.dueDateChanged',
              defaultMessage: 'set due date to {date}',
            },
            { date: String(p.to) }
          )
        : intl.formatMessage({
            id: 'activity.dueDateRemoved',
            defaultMessage: 'removed due date',
          })
    case 'PARENT_CHANGED':
      return p.toTitle
        ? intl.formatMessage(
            {
              id: 'activity.parentChanged',
              defaultMessage: 'set parent to {title}',
            },
            { title: String(p.toTitle) }
          )
        : intl.formatMessage({
            id: 'activity.parentRemoved',
            defaultMessage: 'removed parent task',
          })
    case 'TAGS_CHANGED':
      return intl.formatMessage({
        id: 'activity.tagsChanged',
        defaultMessage: 'updated tags',
      })
    case 'REPOSITORY_CHANGED':
      return intl.formatMessage({
        id: 'activity.repositoryChanged',
        defaultMessage: 'changed repository',
      })
    case 'COMMENT_DELETED':
      return intl.formatMessage({
        id: 'activity.commentDeleted',
        defaultMessage: 'deleted a comment',
      })
    case 'SUBTASK_ADDED':
      return intl.formatMessage(
        {
          id: 'activity.subtaskAdded',
          defaultMessage: 'added subtask {title}',
        },
        { title: String(p.childTitle ?? '') }
      )
    case 'SUBTASK_REMOVED':
      return intl.formatMessage(
        {
          id: 'activity.subtaskRemoved',
          defaultMessage: 'removed subtask {title}',
        },
        { title: String(p.childTitle ?? '') }
      )
    case 'SPEC_GENERATED':
      return intl.formatMessage({
        id: 'activity.specGenerated',
        defaultMessage: 'generated spec',
      })
    case 'BRANCH_CREATED':
      return intl.formatMessage(
        {
          id: 'activity.branchCreated',
          defaultMessage: 'created branch {name}',
        },
        { name: String(p.branchName ?? '') }
      )
    default:
      return (type ?? '').toLowerCase().replace(/_/g, ' ')
  }
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function CompactActivityItem({
  entry,
  members,
  agentActors,
}: CompactActivityItemProps) {
  const intl = useIntl()
  const actorName = resolveActorName(entry, members, agentActors)
  const text = formatActivityText(entry.type, entry.payload, intl)

  return (
    <div className='flex items-center gap-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400'>
      <div className='size-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0'>
        <span className='text-[9px] font-semibold text-zinc-400'>
          {actorName.charAt(0).toUpperCase()}
        </span>
      </div>
      <span>
        <span className='font-medium text-zinc-700 dark:text-zinc-300'>
          {actorName}
        </span>{' '}
        {text}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='ml-auto shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500'>
            {formatTimeAgo(entry.createdAt)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {new Date(entry.createdAt).toLocaleString()}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
