'use client'

import { useIntl } from 'react-intl'
import { AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react'
import {
  boundaryCategoryLabel,
  boundaryDispositionOrOpenLabel,
} from '../boundary-format'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ReactNode } from 'react'
import type { TimelineActivityEntry, WorkspaceMemberInfo } from '../../../types'
import { CommentAvatar } from '../../CommentAvatar'
import {
  TAG_CHIP_CLASS,
  tagChipStyle,
  tagColorScheme,
} from '../../document/tag-colors'
import { statusLabel } from '../../../utils'
import { StatusIcon } from '../../StatusIcon'
import { PRIORITY_CONFIG, PriorityDot } from '../../fields/shared'
import type { ApiPriority } from '../../../types'
import { buildActorMention } from '../ActorMention'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface CompactActivityItemProps {
  entry: TimelineActivityEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

interface ActorInfo {
  name: string
  isAgent: boolean
  imageUrl: string | undefined
}

export function resolveActor(
  entry: Pick<TimelineActivityEntry, 'actorId' | 'actor'>,
  members: WorkspaceMemberInfo[],
  agentActors: { actorId: string; name: string }[]
): ActorInfo {
  if (!entry.actorId) {
    return {
      name: 'System',
      isAgent: false,
      imageUrl: undefined,
    }
  }
  if (entry.actor?.type === 'AGENT') {
    const name = entry.actor.agent?.name ?? 'Agent'
    return {
      name,
      isAgent: true,
      imageUrl: undefined,
    }
  }
  const member = members.find(m => m.actorId === entry.actorId)
  if (member) {
    return {
      name: member.name,
      isAgent: false,
      imageUrl: member.imageUrl ?? undefined,
    }
  }
  // Fallback: check agentActors list
  const agent = agentActors.find(a => a.actorId === entry.actorId)
  if (agent) {
    return {
      name: agent.name,
      isAgent: true,
      imageUrl: undefined,
    }
  }
  return { name: 'Unknown', isAgent: false, imageUrl: undefined }
}

function InlineTagBadge({ name }: { name: string }) {
  return (
    <Badge
      variant='plain'
      size='xs'
      shape='square'
      className={cn('align-middle', TAG_CHIP_CLASS)}
      style={tagChipStyle(tagColorScheme({ name }))}
    >
      {name}
    </Badge>
  )
}

function formatActivityText(
  type: string,
  payload: Record<string, unknown> | null,
  intl: ReturnType<typeof useIntl>,
  members: WorkspaceMemberInfo[],
  agentActors: { actorId: string; name: string }[]
): ReactNode {
  const p = payload ?? {}
  switch (type) {
    case 'TASK_CREATED':
      return intl.formatMessage({
        id: 'activity.taskCreated',
        defaultMessage: 'created this task',
      })
    case 'STATUS_CHANGED': {
      const fromStatus = String(p.from ?? '')
      const toStatus = String(p.to ?? '')
      const fromLabel = statusLabel(intl, fromStatus)
      const toLabel = statusLabel(intl, toStatus)
      return (
        <>
          {intl.formatMessage({
            id: 'activity.statusChanged.prefix',
            defaultMessage: 'changed status from',
          })}{' '}
          <span className='inline-flex items-center gap-1 align-middle'>
            <StatusIcon status={fromStatus} size={12} />
            <span>{fromLabel}</span>
          </span>{' '}
          {intl.formatMessage({
            id: 'activity.statusChanged.to',
            defaultMessage: 'to',
          })}{' '}
          <span className='inline-flex items-center gap-1 align-middle'>
            <StatusIcon status={toStatus} size={12} />
            <span>{toLabel}</span>
          </span>
        </>
      )
    }
    case 'PRIORITY_CHANGED': {
      const fromPriority = String(p.from ?? '') as ApiPriority
      const toPriority = String(p.to ?? '') as ApiPriority
      const fromPriorityLabel =
        PRIORITY_CONFIG[fromPriority]?.label ?? String(p.from ?? '')
      const toPriorityLabel =
        PRIORITY_CONFIG[toPriority]?.label ?? String(p.to ?? '')
      return (
        <>
          {intl.formatMessage({
            id: 'activity.priorityChanged.prefix',
            defaultMessage: 'changed priority from',
          })}{' '}
          <span className='inline-flex items-center gap-1 align-middle'>
            <PriorityDot priority={fromPriority} />
            <span>{fromPriorityLabel}</span>
          </span>{' '}
          {intl.formatMessage({
            id: 'activity.priorityChanged.to',
            defaultMessage: 'to',
          })}{' '}
          <span className='inline-flex items-center gap-1 align-middle'>
            <PriorityDot priority={toPriority} />
            <span>{toPriorityLabel}</span>
          </span>
        </>
      )
    }
    case 'ASSIGNEE_CHANGED': {
      const fromMention = buildActorMention(p.fromActorId, members, agentActors)
      const toMention = buildActorMention(p.toActorId, members, agentActors)
      if (fromMention && toMention) {
        return (
          <>
            {intl.formatMessage({
              id: 'activity.assigneeFromTo.prefix',
              defaultMessage: 'changed assignee from',
            })}{' '}
            {fromMention}{' '}
            {intl.formatMessage({
              id: 'activity.assigneeFromTo.to',
              defaultMessage: 'to',
            })}{' '}
            {toMention}
          </>
        )
      }
      if (toMention) {
        return (
          <>
            {intl.formatMessage({
              id: 'activity.assigneeTo',
              defaultMessage: 'assigned to',
            })}{' '}
            {toMention}
          </>
        )
      }
      return intl.formatMessage({
        id: 'activity.assigneeRemoved',
        defaultMessage: 'removed assignee',
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
      const renderTags = (names: string[]) =>
        names.map((name, i) => (
          <InlineTagBadge key={`${name}-${i}`} name={name} />
        ))
      if (added.length > 0 && removed.length > 0) {
        return (
          <>
            {intl.formatMessage({
              id: 'activity.tagsAdded.prefix',
              defaultMessage: 'added tag',
            })}{' '}
            {renderTags(added)}{' '}
            {intl.formatMessage({
              id: 'activity.tagsRemoved.prefix',
              defaultMessage: 'and removed tag',
            })}{' '}
            {renderTags(removed)}
          </>
        )
      }
      if (added.length > 0) {
        return (
          <>
            {intl.formatMessage({
              id: 'activity.tagsAdded.prefix',
              defaultMessage: 'added tag',
            })}{' '}
            {renderTags(added)}
          </>
        )
      }
      if (removed.length > 0) {
        return (
          <>
            {intl.formatMessage({
              id: 'activity.tagsRemoved.only',
              defaultMessage: 'removed tag',
            })}{' '}
            {renderTags(removed)}
          </>
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
    case 'SENTRY_ALERT': {
      const triggeredRule =
        typeof p.triggeredRule === 'string' ? p.triggeredRule : undefined
      const reopened = p.reopened === true
      const eventCount = typeof p.eventCount === 'number' ? p.eventCount : null
      const label = reopened
        ? intl.formatMessage({
            id: 'activity.sentryReopened',
            defaultMessage: 'reopened by Sentry regression',
          })
        : triggeredRule
          ? intl.formatMessage(
              {
                id: 'activity.sentryAlert',
                defaultMessage: 'Sentry alert: {rule}',
              },
              { rule: triggeredRule }
            )
          : intl.formatMessage({
              id: 'activity.sentryAlertReceived',
              defaultMessage: 'Sentry alert received',
            })
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <AlertTriangle className='h-3.5 w-3.5 text-danger-text' />
          <span>{label}</span>
          {eventCount !== null ? (
            <span className='text-muted-foreground'>· {eventCount} events</span>
          ) : null}
        </span>
      )
    }
    case 'BOUNDARY_CROSSING_DETECTED': {
      const category = String(p.category ?? '')
      const detail = typeof p.detail === 'string' ? p.detail : ''
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <ShieldAlert className='h-3.5 w-3.5 text-warning-text' />
          <span>
            {intl.formatMessage(
              {
                id: 'activity.boundaryDetected',
                defaultMessage: 'flagged a forbidden action — {category}',
              },
              { category: boundaryCategoryLabel(category, intl) }
            )}
            {detail ? (
              <span className='text-muted-foreground'>
                {' '}
                · {detail.length > 80 ? `${detail.slice(0, 80)}…` : detail}
              </span>
            ) : null}
          </span>
        </span>
      )
    }
    case 'BOUNDARY_CROSSING_REJUDGED': {
      // LUM-780: a SYSTEM re-judge — the crossing's cause no longer holds, so
      // the row is advisory now. Not a disposition; a human can still rule.
      const reason = typeof p.reason === 'string' ? p.reason : ''
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <CheckCircle2 className='h-3.5 w-3.5 text-success-text' />
          <span>
            {intl.formatMessage(
              {
                id: 'activity.boundaryRejudged',
                defaultMessage:
                  're-judged the boundary-crossing as advisory — its cause no longer holds ({reason})',
              },
              { reason: reason.toLowerCase().replace(/_/g, ' ') }
            )}
          </span>
        </span>
      )
    }
    case 'BOUNDARY_CROSSING_ACKNOWLEDGED': {
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <CheckCircle2 className='h-3.5 w-3.5 text-success-text' />
          <span>
            {intl.formatMessage({
              id: 'activity.boundaryAcknowledged',
              defaultMessage: 'acknowledged the boundary-crossing',
            })}
          </span>
        </span>
      )
    }
    case 'SECURITY_FINDING_DISPOSITIONED': {
      // LUM-1128: a ruling on a PR security finding, from either surface.
      // `from` non-null = a correction (e.g. the web panel changing a CLI
      // ruling). The channel says which surface ruled.
      const findingLabel = (v: unknown): string =>
        v === 'FALSE_POSITIVE' || v === 'ACCEPTED_RISK'
          ? intl.formatMessage({ id: `securityScan.disposition.${v}` })
          : String(v ?? '')
      const channel = intl.formatMessage({
        id:
          p.channel === 'CLI'
            ? 'activity.securityFindingChannel.CLI'
            : 'activity.securityFindingChannel.WEB',
      })
      const rule = typeof p.ruleId === 'string' ? p.ruleId : ''
      // LUM-1128 follow-up: `to: 'OPEN'` is a web-panel revert — the ruling
      // is gone and the finding is undecided (and blocking, if it was) again.
      if (p.to === 'OPEN') {
        return (
          <span className='inline-flex items-center gap-1 align-middle'>
            <ShieldAlert className='h-3.5 w-3.5 text-warning-text' />
            <span data-testid='activity-security-finding-reopened'>
              {intl.formatMessage(
                { id: 'activity.securityFindingReopened' },
                { rule, from: findingLabel(p.from), channel }
              )}
            </span>
          </span>
        )
      }
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <CheckCircle2 className='h-3.5 w-3.5 text-success-text' />
          <span data-testid='activity-security-finding-dispositioned'>
            {p.from
              ? intl.formatMessage(
                  { id: 'activity.securityFindingRedispositioned' },
                  {
                    rule,
                    from: findingLabel(p.from),
                    to: findingLabel(p.to),
                    channel,
                  }
                )
              : intl.formatMessage(
                  { id: 'activity.securityFindingDispositioned' },
                  { rule, to: findingLabel(p.to), channel }
                )}
          </span>
        </span>
      )
    }
    case 'BOUNDARY_CROSSING_DISPOSITIONED': {
      // LUM-450: a disposition activity may be a first disposition (from absent
      // / null) OR a re-disposition (from non-null) — including a revert to OPEN
      // (to === null). Legacy rows carry only `disposition` (the new value).
      const norm = (
        v: unknown
      ):
        | 'FALSE_POSITIVE'
        | 'CONFIRMED'
        | 'AUTO_LEGIT'
        | 'AUTO_SUPPRESSED'
        | null =>
        v === 'FALSE_POSITIVE' ||
        v === 'CONFIRMED' ||
        v === 'AUTO_LEGIT' ||
        v === 'AUTO_SUPPRESSED'
          ? v
          : null
      const to = 'to' in p ? norm(p.to) : norm(p.disposition)
      const from = norm(p.from)
      if (from !== null) {
        // A correction: changed verdict, or reverted to open. Render from -> to.
        const isReopen = to === null
        return (
          <span className='inline-flex items-center gap-1 align-middle'>
            {isReopen ? (
              <ShieldAlert className='h-3.5 w-3.5 text-warning-text' />
            ) : (
              <CheckCircle2 className='h-3.5 w-3.5 text-success-text' />
            )}
            <span>
              {isReopen
                ? intl.formatMessage(
                    {
                      id: 'activity.boundaryReopened',
                      defaultMessage:
                        'reopened the boundary-crossing (was {from}) — Done re-blocked',
                    },
                    { from: boundaryDispositionOrOpenLabel(from, intl) }
                  )
                : intl.formatMessage(
                    {
                      id: 'activity.boundaryRedispositioned',
                      defaultMessage:
                        'changed the boundary-crossing disposition from {from} to {to}',
                    },
                    {
                      from: boundaryDispositionOrOpenLabel(from, intl),
                      to: boundaryDispositionOrOpenLabel(to, intl),
                    }
                  )}
            </span>
          </span>
        )
      }
      const isConfirmed = to === 'CONFIRMED'
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <CheckCircle2 className='h-3.5 w-3.5 text-success-text' />
          <span>
            {isConfirmed
              ? intl.formatMessage({
                  id: 'activity.boundaryConfirmed',
                  defaultMessage: 'confirmed the boundary-crossing',
                })
              : intl.formatMessage({
                  id: 'activity.boundaryFalsePositive',
                  defaultMessage:
                    'marked the boundary-crossing a false positive',
                })}
          </span>
        </span>
      )
    }
    case 'BOUNDARY_CROSSING_REMEDIATION_SPAWNED': {
      return (
        <span className='inline-flex items-center gap-1 align-middle'>
          <ShieldAlert className='h-3.5 w-3.5 text-warning-text' />
          <span>
            {intl.formatMessage({
              id: 'activity.boundaryRemediationSpawned',
              defaultMessage:
                'spawned a remediation task for a boundary-crossing',
            })}
          </span>
        </span>
      )
    }
    default:
      return (type ?? '').toLowerCase().replace(/_/g, ' ')
  }
}

export function formatTimeAgo(dateStr: string, locale: string = 'en'): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const seconds = Math.floor(diff / 1000)

  if (seconds < 60)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      0,
      'second'
    )

  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: 'always',
    style: 'narrow',
  })
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  return rtf.format(-days, 'day')
}

export function CompactActivityItem({
  entry,
  members,
  agentActors,
}: CompactActivityItemProps) {
  const intl = useIntl()
  const actor = resolveActor(entry, members, agentActors)
  const text = formatActivityText(
    entry.type,
    entry.payload,
    intl,
    members,
    agentActors
  )

  return (
    <div className='flex gap-2.5 py-2 text-caption text-muted-foreground'>
      <CommentAvatar
        isAgent={actor.isAgent}
        imageUrl={actor.imageUrl}
        name={actor.name}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-2'>
          <span className='text-foreground'>{actor.name}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='text-caption text-muted-foreground'>
                {formatTimeAgo(entry.createdAt, intl.locale)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {new Date(entry.createdAt).toLocaleString(intl.locale)}
            </TooltipContent>
          </Tooltip>
        </div>
        <span>{text}</span>
      </div>
    </div>
  )
}
