'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { TAB_SLUGS, tabFromSlug, type TabValue } from './taskTabs'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { useMemories } from '../../hooks/useMemories'
import { useTaskLineage } from '../../hooks/useTaskLineage'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import { ContextTab } from './ContextTab'
import { LineageTab } from './LineageTab'
import { DeliveryTab, type DeliverySubTab } from './DeliveryTab'
import { VerdictDecision, type HumanVerdictResult } from './VerdictDecision'
import { MemoryTab } from '../memory/MemoryTab'
import type { TaskDetail } from '../../types'
import type { MentionSources } from '@/types/mention'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

/** Server-computed presence of the "rare" tabs, so the tab bar can paint
 *  on first render instead of waiting for the client probes (LUM-321). */
interface TimelinePresence {
  hasMemories: boolean
  hasLineage: boolean
  hasCriteria: boolean
}

interface TimelineTabsProps {
  taskId: string
  taskIdentifier: string
  taskStatus: TaskDetail['status']
  agentStatus?: string | null | undefined
  workspaceId: string
  workspaceUrl: string
  commentsProps: React.ComponentProps<typeof TaskDetailComments>
  slackConnected: boolean
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
  onVerdictRecorded?: (result: HumanVerdictResult) => void
  mentionSources?: MentionSources
  /** SSR presence seed; the probes below reconcile it once they resolve. */
  initialTimelinePresence?: TimelinePresence | undefined
}

export function TimelineTabs({
  taskId,
  taskIdentifier,
  taskStatus,
  agentStatus,
  workspaceId,
  workspaceUrl,
  commentsProps,
  slackConnected,
  pullRequests,
  onLinkPr,
  onUnlinkPr,

  onVerdictRecorded = () => {},
  mentionSources,
  initialTimelinePresence,
}: TimelineTabsProps) {
  const intl = useIntl()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()

  // The active tab lives in the URL path segment (e.g. /LUM-1/acceptance) so it
  // survives reload, is shareable, and the browser back/forward buttons walk
  // between tabs. `[[...tab]]` delivers the segment as an optional string[].
  const urlSlug = (params.tab as string[] | undefined)?.[0]
  const urlTab = tabFromSlug(urlSlug)
  const basePath = urlSlug
    ? pathname.slice(0, pathname.length - urlSlug.length - 1)
    : pathname

  // Optimistic mirror of the URL tab: a click sets this instantly while
  // router.push updates the URL in the background (the RSC nav has latency).
  // The effect below reconciles it from the URL for back/forward and reload.
  const [activeTab, setActiveTab] = useState<TabValue>(urlTab ?? 'comments')

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
  const taskMemories = useMemories({
    scope: 'task',
    parentId: taskId,
    enabled: true,
  })
  const lineage = useTaskLineage({ identifier: taskIdentifier, enabled: true })
  const status = useTaskStatus({ identifier: taskIdentifier, enabled: true })

  // Until a probe resolves, fall back to the SSR-seeded presence so the tab
  // bar paints correctly on first render (no pop-in); once a probe lands it
  // becomes the source of truth and reconciles any drift. useTaskLineage
  // signals "not yet resolved" via data===null; useMemories has no null
  // sentinel, so its initial load is read from `loading`.
  const hasMemories = taskMemories.loading
    ? (initialTimelinePresence?.hasMemories ?? false)
    : taskMemories.memories.length > 0
  const hasLineage = lineage.data
    ? lineage.data.groups.length > 0
    : (initialTimelinePresence?.hasLineage ?? false)
  // The read-only Acceptance tab (LUM-423) shows only once a contract exists —
  // same probe-with-SSR-fallback pattern as the three above.
  const hasCriteria = status.data
    ? status.data.criteria.length > 0
    : (initialTimelinePresence?.hasCriteria ?? false)

  // The Delivery tab folds Agent Runs + Acceptance into one tab with a sub-
  // segment. `null` here means "use the status-derived default"; an explicit
  // user click on the sub-segment overrides it. Computed each render (no
  // effect) so it stays in sync with the live status without an extra pass.
  const [deliverySubTab, setDeliverySubTab] = useState<DeliverySubTab | null>(
    null
  )
  const defaultSubTab: DeliverySubTab =
    status.data?.task.status === 'IN_REVIEW' && hasCriteria
      ? 'acceptance'
      : 'runs'
  const resolvedSubTab = deliverySubTab ?? defaultSubTab

  // Reconcile the rendered tab with the URL: handles reload, back/forward, and
  // the case where the URL targets an unknown or currently-hidden tab — fall
  // back to Comments and strip the dead segment from the URL (replace, so the
  // bad URL doesn't pollute history).
  useEffect(() => {
    if (!urlSlug) return
    // Wait until the probe backing this tab has resolved before treating it as
    // hidden — otherwise a deep link to a probe-backed tab (memory/lineage)
    // gets normalized away on the transient unresolved value before the probe
    // lands, flashing to Comments and writing a stale URL. The "resolved"
    // signals mirror the visibility derivation below: useTaskLineage exposes
    // data !== null once loaded; useMemories signals it via loading === false.
    // The Delivery tab (slug 'delivery' → urlTab 'agent') is always visible, so
    // it needs no probe gate.
    const probeResolved =
      urlTab === 'memory'
        ? !taskMemories.loading
        : urlTab === 'lineage'
          ? lineage.data !== null
          : true
    if (!probeResolved) return
    const visible =
      urlTab === 'agent'
        ? true
        : urlTab === 'memory'
          ? hasMemories
          : urlTab === 'lineage'
            ? hasLineage
            : urlTab !== null
    if (urlTab && visible) {
      setActiveTab(urlTab)
    } else {
      setActiveTab('comments')
      router.replace(basePath, { scroll: false })
    }
  }, [
    urlTab,
    urlSlug,
    basePath,
    router,
    hasMemories,
    hasLineage,
    taskMemories.loading,
    lineage.data,
  ])

  // Switch tab: instant client switch (optimistic) + URL update so back/forward
  // and deep links work. Comments is the default tab → bare URL, no segment.
  const selectTab = (tab: TabValue) => {
    setActiveTab(tab)
    const target =
      tab === 'comments' ? basePath : `${basePath}/${TAB_SLUGS[tab]}`
    router.push(target, { scroll: false })
  }

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
      {status.data &&
        status.data.task.status === 'IN_REVIEW' &&
        hasCriteria && (
          <VerdictDecision
            variant='floating'
            taskIdentifier={taskIdentifier}
            data={status.data}
            onVerdictRecorded={onVerdictRecorded}
            {...(mentionSources ? { mentionSources } : {})}
          />
        )}
      <div className='flex gap-4 mb-4'>
        <button
          className={tabClass(activeTab === 'comments')}
          onClick={() => selectTab('comments')}
        >
          {intl.formatMessage({
            id: 'task.comments',
            defaultMessage: 'Comments',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'activity')}
          onClick={() => selectTab('activity')}
        >
          {intl.formatMessage({
            id: 'task.activity',
            defaultMessage: 'Activity',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'context')}
          onClick={() => selectTab('context')}
        >
          {intl.formatMessage({
            id: 'task.context.tab',
            defaultMessage: 'Context',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'agent')}
          onClick={() => selectTab('agent')}
        >
          {intl.formatMessage({
            id: 'task.delivery',
            defaultMessage: 'Delivery',
          })}
        </button>
        {hasMemories && (
          <button
            className={tabClass(activeTab === 'memory')}
            onClick={() => selectTab('memory')}
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
            onClick={() => selectTab('lineage')}
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
        <DeliveryTab
          taskId={taskId}
          taskIdentifier={taskIdentifier}
          taskStatus={taskStatus}
          agentStatus={agentStatus}
          workspaceUrl={workspaceUrl}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
          enabled={activeTab === 'agent'}
          subTab={resolvedSubTab}
          onSubTabChange={setDeliverySubTab}
          onVerdictRecorded={onVerdictRecorded}
          {...(mentionSources ? { mentionSources } : {})}
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
