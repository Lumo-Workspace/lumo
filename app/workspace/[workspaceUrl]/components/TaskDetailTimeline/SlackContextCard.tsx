'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { RefreshCw, Trash2, MessageSquare } from 'lucide-react'
import type { SlackContextResource } from '@/lib/api-client/slack-contexts'
import { formatRelativeAgo } from '@/lib/datetime/relative'
import { useNow } from '@/hooks/use-now'
import { SlackMrkdwn } from './slackMrkdwn'
import { ContentSignalsBadge } from '../ContentSignalsBadge'

interface Props {
  context: SlackContextResource
  onRefresh: () => Promise<void>
  onUnlink: () => Promise<void>
}

export function SlackContextCard({
  context,
  onRefresh,
  onUnlink,
}: Props): React.ReactElement {
  const intl = useIntl()
  const now = useNow()
  const [expanded, setExpanded] = useState(!context.isThread)
  const [busy, setBusy] = useState(false)
  const snapshotAgo =
    now != null ? formatRelativeAgo(intl, context.snapshotAt, now) : ''

  const msgs = context.snapshot.messages
  const root = msgs[0]
  const replies = msgs.slice(1)
  const userMap: Record<string, string | null> = {}
  for (const m of msgs) userMap[m.userId] = m.userName

  const handleRefresh = async () => {
    setBusy(true)
    try {
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const handleUnlink = async () => {
    setBusy(true)
    try {
      await onUnlink()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='border border-border rounded-md p-3 bg-card'>
      <div className='flex items-center gap-2 text-caption text-muted-foreground'>
        <MessageSquare size={14} />
        <a
          href={context.permalink}
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-foreground'
        >
          #{context.slackChannelName ?? 'channel'}
        </a>
        <ContentSignalsBadge signals={context.contentSignals} />
        <span>·</span>
        <span>{root?.userName ?? `@${root?.userId ?? '?'}`}</span>
        <span>·</span>
        <span>
          {intl.formatMessage(
            { id: 'slackContext.fetchedAgo', defaultMessage: 'Fetched {ago}' },
            { ago: snapshotAgo }
          )}
        </span>
        <div className='ml-auto flex items-center gap-1'>
          <button
            onClick={handleRefresh}
            disabled={busy}
            title={intl.formatMessage({
              id: 'slackContext.refresh',
              defaultMessage: 'Refresh',
            })}
            className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleUnlink}
            disabled={busy}
            title={intl.formatMessage({
              id: 'slackContext.unlink',
              defaultMessage: 'Remove',
            })}
            className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {root && (
        <div className='mt-2 text-body text-foreground whitespace-pre-wrap'>
          <SlackMrkdwn text={root.text} userMap={userMap} />
        </div>
      )}

      {context.isThread && replies.length > 0 && (
        <div className='mt-2'>
          <button
            onClick={() => setExpanded(e => !e)}
            className='text-caption text-muted-foreground hover:text-foreground'
          >
            {expanded ? '▼' : '▶'}{' '}
            {intl.formatMessage(
              {
                id: 'slackContext.thread.replies',
                defaultMessage: '{n, plural, one {1 reply} other {# replies}}',
              },
              { n: replies.length }
            )}
          </button>
          {expanded && (
            <div className='mt-2 pl-3 border-l-2 border-border space-y-2'>
              {replies.map(m => (
                <div key={m.ts} className='text-body'>
                  <span className='font-medium'>
                    {m.userName ?? `@${m.userId}`}
                  </span>
                  <span className='ml-2 text-foreground whitespace-pre-wrap'>
                    <SlackMrkdwn text={m.text} userMap={userMap} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {context.refreshError && (
        <div className='mt-2 text-caption text-amber-600 dark:text-amber-400'>
          {intl.formatMessage(
            {
              id: 'slackContext.refresh.failedBanner',
              defaultMessage: 'Refresh failed · {ago}',
            },
            { ago: snapshotAgo }
          )}
        </div>
      )}
    </div>
  )
}
