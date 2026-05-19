'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import { AgentRunTab } from '../AgentRunTimeline/AgentRunTab'
import { SlackContextTab } from './SlackContextTab'

type TabValue = 'comments' | 'activity' | 'slack' | 'agent'

interface TimelineTabsProps {
  taskId: string
  commentsProps: React.ComponentProps<typeof TaskDetailComments>
  slackConnected: boolean
}

export function TimelineTabs({
  taskId,
  commentsProps,
  slackConnected,
}: TimelineTabsProps) {
  const intl = useIntl()
  const [activeTab, setActiveTab] = useState<TabValue>('comments')

  const timeline = useTimeline({
    taskId,
    enabled: activeTab === 'activity',
  })

  const agentRuns = useAgentRuns({ taskId, enabled: true })
  const unsyncedMemoryCount = agentRuns.data?.unsyncedMemoryCount ?? 0

  const tabClass = (active: boolean) =>
    `pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
      active
        ? 'text-zinc-800 dark:text-zinc-200 border-b-2 border-zinc-800 dark:border-zinc-200'
        : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600'
    }`

  return (
    <div className='mt-8'>
      {/* Tab bar */}
      <div className='flex gap-4 mb-4'>
        <button
          className={tabClass(activeTab === 'comments')}
          onClick={() => setActiveTab('comments')}
        >
          {intl.formatMessage({
            id: 'task.comments',
            defaultMessage: 'Comments',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'activity')}
          onClick={() => setActiveTab('activity')}
        >
          {intl.formatMessage({
            id: 'task.activity',
            defaultMessage: 'Activity',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'slack')}
          onClick={() => setActiveTab('slack')}
        >
          {intl.formatMessage({
            id: 'slackContext.tab',
            defaultMessage: 'Slack Context',
          })}
        </button>
        <button
          className={`flex items-center gap-1.5 ${tabClass(activeTab === 'agent')}`}
          onClick={() => setActiveTab('agent')}
        >
          {intl.formatMessage({
            id: 'task.agentRun',
            defaultMessage: 'Agent 运行',
          })}
          {unsyncedMemoryCount > 0 && (
            <span className='normal-case tracking-normal text-[10px] font-medium px-1.5 py-px rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'>
              {intl.formatMessage(
                {
                  id: 'agentRun.memoryBadge',
                  defaultMessage: '+{n} 条新记忆',
                },
                { n: unsyncedMemoryCount }
              )}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'activity' && (
        <ActivityTimeline
          entries={timeline.entries}
          loading={timeline.loading}
          hasMore={timeline.hasMore}
          loadingMore={timeline.loadingMore}
          onLoadMore={timeline.loadMore}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
        />
      )}
      {activeTab === 'comments' && <TaskDetailComments {...commentsProps} />}
      {activeTab === 'slack' && (
        <SlackContextTab taskId={taskId} slackConnected={slackConnected} />
      )}
      {activeTab === 'agent' && (
        <AgentRunTab
          taskId={taskId}
          enabled={activeTab === 'agent'}
          memoryCount={unsyncedMemoryCount}
        />
      )}
    </div>
  )
}
