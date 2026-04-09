'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'

type TabValue = 'activity' | 'comments'

interface TimelineTabsProps {
  taskId: string
  commentsProps: React.ComponentProps<typeof TaskDetailComments>
}

export function TimelineTabs({ taskId, commentsProps }: TimelineTabsProps) {
  const intl = useIntl()
  const [activeTab, setActiveTab] = useState<TabValue>('activity')

  const timeline = useTimeline({
    taskId,
    enabled: activeTab === 'activity',
  })

  return (
    <div className='mt-8'>
      {/* Tab bar */}
      <div className='flex gap-4 border-b border-zinc-100 dark:border-zinc-800 mb-4'>
        <button
          className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === 'activity'
              ? 'text-zinc-800 dark:text-zinc-200 border-b-2 border-zinc-800 dark:border-zinc-200'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600'
          }`}
          onClick={() => setActiveTab('activity')}
        >
          {intl.formatMessage({
            id: 'task.activity',
            defaultMessage: 'Activity',
          })}
        </button>
        <button
          className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === 'comments'
              ? 'text-zinc-800 dark:text-zinc-200 border-b-2 border-zinc-800 dark:border-zinc-200'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600'
          }`}
          onClick={() => setActiveTab('comments')}
        >
          {intl.formatMessage({
            id: 'task.comments',
            defaultMessage: 'Comments',
          })}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'activity' ? (
        <ActivityTimeline
          entries={timeline.entries}
          loading={timeline.loading}
          hasMore={timeline.hasMore}
          loadingMore={timeline.loadingMore}
          onLoadMore={timeline.loadMore}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
        />
      ) : (
        <TaskDetailComments {...commentsProps} />
      )}
    </div>
  )
}
