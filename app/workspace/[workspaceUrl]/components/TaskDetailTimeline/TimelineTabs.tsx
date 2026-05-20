'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import { AgentRunTab } from '../AgentRunTimeline/AgentRunTab'
import { ContextTab } from './ContextTab'

type TabValue = 'comments' | 'activity' | 'context' | 'agent'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

interface TimelineTabsProps {
  taskId: string
  workspaceId: string
  workspaceUrl: string
  commentsProps: React.ComponentProps<typeof TaskDetailComments>
  slackConnected: boolean
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
}

export function TimelineTabs({
  taskId,
  workspaceId,
  workspaceUrl,
  commentsProps,
  slackConnected,
  pullRequests,
  onLinkPr,
  onUnlinkPr,
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
          className={tabClass(activeTab === 'context')}
          onClick={() => setActiveTab('context')}
        >
          {intl.formatMessage({
            id: 'task.context.tab',
            defaultMessage: 'Context',
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
                { id: 'agentRun.memoryBadge', defaultMessage: '+{n} 条新记忆' },
                { n: unsyncedMemoryCount }
              )}
            </span>
          )}
        </button>
      </div>

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
      {activeTab === 'context' && (
        <ContextTab
          taskId={taskId}
          workspaceId={workspaceId}
          workspaceUrl={workspaceUrl}
          slackConnected={slackConnected}
          pullRequests={pullRequests}
          onLinkPr={onLinkPr}
          onUnlinkPr={onUnlinkPr}
          enabled={activeTab === 'context'}
        />
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
