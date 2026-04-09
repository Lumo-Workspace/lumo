'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { TimelineEntry, WorkspaceMemberInfo } from '../../types'
import { TimelineEntryRenderer } from './TimelineEntryRenderer'

interface ActivityTimelineProps {
  entries: TimelineEntry[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

export function ActivityTimeline({
  entries,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  members,
  agentActors,
}: ActivityTimelineProps) {
  const intl = useIntl()

  if (loading) {
    return (
      <div className='space-y-3 py-4'>
        {[1, 2, 3].map(i => (
          <div key={i} className='flex gap-2.5'>
            <div className='size-5 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0' />
            <div className='flex-1 space-y-1.5 pt-0.5'>
              <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-2/3' />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className='text-xs text-zinc-400 dark:text-zinc-500 py-4'>
        {intl.formatMessage({
          id: 'activity.empty',
          defaultMessage: 'No activity yet',
        })}
      </p>
    )
  }

  return (
    <div className='py-2'>
      {hasMore && (
        <div className='flex justify-center mb-3'>
          <Button
            variant='ghost'
            size='sm'
            className='text-xs text-zinc-400 hover:text-zinc-600'
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? <Spinner className='size-3 mr-1' /> : null}
            {intl.formatMessage({
              id: 'activity.loadEarlier',
              defaultMessage: 'Load earlier activity',
            })}
          </Button>
        </div>
      )}
      <div className='space-y-0.5'>
        {entries.map(entry => (
          <TimelineEntryRenderer
            key={`${entry.kind}-${entry.id}`}
            entry={entry}
            members={members}
            agentActors={agentActors}
          />
        ))}
      </div>
    </div>
  )
}
