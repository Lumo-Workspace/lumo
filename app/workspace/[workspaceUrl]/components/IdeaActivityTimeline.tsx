'use client'

import { useIntl } from 'react-intl'
import { useIdeaActivity } from '../hooks/useIdeaActivity'
import { ApiIdeaActivity } from '../types'

/**
 * The Activity tab of the idea detail slide-over (LUM-680). Renders the idea's
 * lifecycle timeline (oldest first): captured, statement edits, status changes,
 * and comments. Each entry's label is derived from its `type` (+ `payload` for
 * a status change's target). Presentation only (SRP); data from
 * `useIdeaActivity`.
 */
export function IdeaActivityTimeline({ ideaId }: { ideaId: string }) {
  const intl = useIntl()
  const { activity, loading, error } = useIdeaActivity(ideaId)

  if (loading) {
    return (
      <p className='text-xs text-muted-foreground'>
        {intl.formatMessage({ id: 'common.loading' })}
      </p>
    )
  }
  if (error) {
    return <p className='text-xs text-danger-text'>{error}</p>
  }
  if (activity.length === 0) {
    return (
      <p className='text-xs text-muted-foreground'>
        {intl.formatMessage({ id: 'ideas.activity.empty' })}
      </p>
    )
  }

  return (
    <ul className='flex flex-col gap-3'>
      {activity.map(entry => (
        <li key={entry.id} className='flex flex-col gap-0.5'>
          <span className='text-sm text-foreground/90'>
            {labelFor(entry, intl)}
          </span>
          <time className='text-[10px] uppercase tracking-wide text-muted-foreground'>
            {intl.formatDate(new Date(entry.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
        </li>
      ))}
    </ul>
  )
}

/** Human label for one activity entry. STATUS_CHANGED reads its target status. */
function labelFor(
  entry: ApiIdeaActivity,
  intl: ReturnType<typeof useIntl>
): string {
  switch (entry.type) {
    case 'IDEA_CAPTURED':
      return intl.formatMessage({ id: 'ideas.activity.captured' })
    case 'STATEMENT_CHANGED':
      return intl.formatMessage({ id: 'ideas.activity.statementChanged' })
    case 'STATUS_CHANGED': {
      const to = typeof entry.payload?.to === 'string' ? entry.payload.to : '?'
      return intl.formatMessage({ id: 'ideas.activity.statusChanged' }, { to })
    }
    case 'COMMENT_ADDED':
      return intl.formatMessage({ id: 'ideas.activity.commentAdded' })
    default:
      return entry.type
  }
}
