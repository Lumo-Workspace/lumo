'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { useMemories } from '../../hooks/useMemories'
import { useTaskLineage } from '../../hooks/useTaskLineage'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import { AgentRunTab } from '../AgentRunTimeline/AgentRunTab'
import { ContextTab } from './ContextTab'
import { LineageTab } from './LineageTab'
import { MemoryTab } from '../memory/MemoryTab'

type TabValue =
  | 'comments'
  | 'activity'
  | 'context'
  | 'agent'
  | 'memory'
  | 'lineage'

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
  taskIdentifier: string
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
  taskIdentifier,
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

  // Presence probes for the Agent Run / Memory / Lineage tabs. These three are
  // empty for most tasks, so rather than always offering a tab that only
  // reveals an empty state, we hide the tab entirely until it has content.
  //
  // The probes run regardless of which tab is active (enabled: true). They
  // share React Query cache keys with the tab panels below, so this adds no
  // extra network request when the tab is later opened — it just warms the
  // cache so the panel paints instantly. Presence is derived from the *same*
  // data each panel uses to decide its own empty state, so the tab bar can
  // never drift out of sync with the panel (show a tab that then says "empty",
  // or hide one that has content).
  const agentRuns = useAgentRuns({ taskId, enabled: true })
  const taskMemories = useMemories({
    scope: 'task',
    parentId: taskId,
    enabled: true,
  })
  const lineage = useTaskLineage({ identifier: taskIdentifier, enabled: true })

  const hasAgentRuns = (agentRuns.data?.runs.length ?? 0) > 0
  const hasMemories = taskMemories.memories.length > 0
  const hasLineage = (lineage.data?.groups.length ?? 0) > 0

  // WorkspaceMember.id → display name, so the Memory tab can show "Added by X"
  // for manually-created memories (createdByMemberId is a WorkspaceMember.id).
  const memoryMemberNames = useMemo(
    () => new Map(commentsProps.members.map(m => [m.id, m.name])),
    [commentsProps.members]
  )

  const tabClass = (active: boolean) =>
    `pb-2 text-caption font-semibold uppercase tracking-wider transition-colors ${
      active
        ? 'text-foreground border-b-2 border-foreground'
        : 'text-muted-foreground hover:text-foreground'
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
        {hasAgentRuns && (
          <button
            className={tabClass(activeTab === 'agent')}
            onClick={() => setActiveTab('agent')}
          >
            {intl.formatMessage({
              id: 'task.agentRun',
              defaultMessage: 'Agent 运行',
            })}
          </button>
        )}
        {hasMemories && (
          <button
            className={tabClass(activeTab === 'memory')}
            onClick={() => setActiveTab('memory')}
          >
            {intl.formatMessage({
              id: 'memory.tab.title',
              defaultMessage: 'Memory',
            })}
          </button>
        )}
        {hasLineage && (
          <button
            className={tabClass(activeTab === 'lineage')}
            onClick={() => setActiveTab('lineage')}
          >
            {intl.formatMessage({
              id: 'task.lineage',
              defaultMessage: 'Lineage',
            })}
          </button>
        )}
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
          taskIdentifier={taskIdentifier}
          enabled={activeTab === 'agent'}
        />
      )}
      {activeTab === 'memory' && (
        <MemoryTab
          scope='task'
          parentId={taskId}
          enabled={activeTab === 'memory'}
          memberNames={memoryMemberNames}
        />
      )}
      {activeTab === 'lineage' && (
        <LineageTab
          taskIdentifier={taskIdentifier}
          enabled={activeTab === 'lineage'}
        />
      )}
    </div>
  )
}
