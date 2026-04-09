'use client'

import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { TimelineActivityEntry, WorkspaceMemberInfo } from '../../../types'
import { CommentAvatar } from '../../CommentAvatar'
import { API_STATUS_LABEL } from '../../../utils'
import { PRIORITY_CONFIG } from '../../fields/shared'

interface CompactActivityItemProps {
  entry: TimelineActivityEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

interface ActorInfo {
  name: string
  isAgent: boolean
  imageUrl: string | undefined
  initials: string
}

function resolveActor(
  entry: TimelineActivityEntry,
  members: WorkspaceMemberInfo[],
  agentActors: { actorId: string; name: string }[]
): ActorInfo {
  if (!entry.actorId) {
    return {
      name: 'System',
      isAgent: false,
      imageUrl: undefined,
      initials: 'S',
    }
  }
  if (entry.actor?.type === 'AGENT') {
    const name = entry.actor.agent?.name ?? 'Agent'
    return {
      name,
      isAgent: true,
      imageUrl: undefined,
      initials: name.charAt(0),
    }
  }
  const member = members.find(m => m.actorId === entry.actorId)
  if (member) {
    const initials = member.name
      .split(' ')
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
    return {
      name: member.name,
      isAgent: false,
      imageUrl: member.imageUrl ?? undefined,
      initials,
    }
  }
  // Fallback: check agentActors list
  const agent = agentActors.find(a => a.actorId === entry.actorId)
  if (agent) {
    return {
      name: agent.name,
      isAgent: true,
      imageUrl: undefined,
      initials: agent.name.charAt(0),
    }
  }
  return { name: 'Unknown', isAgent: false, imageUrl: undefined, initials: '?' }
}

function resolveNameByActorId(
  actorId: unknown,
  members: WorkspaceMemberInfo[]
): string | null {
  if (typeof actorId !== 'string' || !actorId) return null
  const member = members.find(m => m.actorId === actorId)
  return member?.name ?? null
}

function formatActivityText(
  type: string,
  payload: Record<string, unknown> | null,
  intl: ReturnType<typeof useIntl>,
  members: WorkspaceMemberInfo[]
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
        {
          from: API_STATUS_LABEL[String(p.from ?? '')] ?? String(p.from ?? ''),
          to: API_STATUS_LABEL[String(p.to ?? '')] ?? String(p.to ?? ''),
        }
      )
    case 'PRIORITY_CHANGED':
      return intl.formatMessage(
        {
          id: 'activity.priorityChanged',
          defaultMessage: 'changed priority from {from} to {to}',
        },
        {
          from:
            PRIORITY_CONFIG[
              String(p.from ?? '') as keyof typeof PRIORITY_CONFIG
            ]?.label ?? String(p.from ?? ''),
          to:
            PRIORITY_CONFIG[String(p.to ?? '') as keyof typeof PRIORITY_CONFIG]
              ?.label ?? String(p.to ?? ''),
        }
      )
    case 'ASSIGNEE_CHANGED': {
      const assigneeName = p.toName
        ? String(p.toName)
        : resolveNameByActorId(p.toActorId, members)
      return assigneeName
        ? intl.formatMessage(
            {
              id: 'activity.assigneeChanged',
              defaultMessage: 'assigned to {name}',
            },
            { name: assigneeName }
          )
        : intl.formatMessage({
            id: 'activity.assigneeRemoved',
            defaultMessage: 'removed assignee',
          })
    }
    case 'REVIEWER_CHANGED': {
      const reviewerName = p.toName
        ? String(p.toName)
        : resolveNameByActorId(p.toActorId, members)
      return reviewerName
        ? intl.formatMessage(
            {
              id: 'activity.reviewerChanged',
              defaultMessage: 'set reviewer to {name}',
            },
            { name: reviewerName }
          )
        : intl.formatMessage({
            id: 'activity.reviewerRemoved',
            defaultMessage: 'removed reviewer',
          })
    }
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
    case 'TAGS_CHANGED': {
      const added = Array.isArray(p.added) ? (p.added as string[]) : []
      const removed = Array.isArray(p.removed) ? (p.removed as string[]) : []
      if (added.length > 0 && removed.length > 0) {
        return intl.formatMessage(
          {
            id: 'activity.tagsAddedRemoved',
            defaultMessage: 'added tag {added} and removed tag {removed}',
          },
          { added: added.join(', '), removed: removed.join(', ') }
        )
      }
      if (added.length > 0) {
        return intl.formatMessage(
          { id: 'activity.tagsAdded', defaultMessage: 'added tag {added}' },
          { added: added.join(', ') }
        )
      }
      if (removed.length > 0) {
        return intl.formatMessage(
          {
            id: 'activity.tagsRemoved',
            defaultMessage: 'removed tag {removed}',
          },
          { removed: removed.join(', ') }
        )
      }
      return intl.formatMessage({
        id: 'activity.tagsChanged',
        defaultMessage: 'updated tags',
      })
    }
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
  const actor = resolveActor(entry, members, agentActors)
  const text = formatActivityText(entry.type, entry.payload, intl, members)

  return (
    <div className='flex gap-2.5 py-2 text-xs text-zinc-500 dark:text-zinc-400'>
      <CommentAvatar
        isAgent={actor.isAgent}
        imageUrl={actor.imageUrl}
        initials={actor.initials}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-2'>
          <span className='font-medium text-zinc-700 dark:text-zinc-300'>
            {actor.name}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='text-[11px] text-zinc-400 dark:text-zinc-500'>
                {formatTimeAgo(entry.createdAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {new Date(entry.createdAt).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        </div>
        <span>{text}</span>
      </div>
    </div>
  )
}
