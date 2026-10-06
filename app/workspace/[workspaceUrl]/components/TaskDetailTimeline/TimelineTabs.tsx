'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { TAB_SLUGS, resolveTab, type TabValue } from './taskTabs'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { useMemories } from '../../hooks/useMemories'
import { useTaskLineage } from '../../hooks/useTaskLineage'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import { ContextTab } from './ContextTab'
import { TaskDossier } from './TaskDossier'
import type { TaskDetail } from '../../types'

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
  hasOpenCrossings: boolean
  /** LUM-801：服务端预判。LUM-1011 起用例是 Record 的固定区段，tab 栏不再读它。 */
  hasTestCases: boolean
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
  initialTimelinePresence,
}: TimelineTabsProps) {
  const intl = useIntl()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()

  // The active tab lives in the URL path segment (e.g. /LUM-1/record) so it
  // survives reload, is shareable, and the browser back/forward buttons walk
  // between tabs. `[[...tab]]` delivers the segment as an optional string[].
  const urlSlug = (params.tab as string[] | undefined)?.[0]
  // resolveTab is a superset of tabFromSlug: it also maps the legacy
  // Delivery / Lineage / Memory slugs onto the dossier tab + the ④ sub-section
  // to expand (LUM-458 deep links survive the tab merge, LUM-567).
  const resolved = resolveTab(urlSlug)
  const urlTab = resolved?.tab ?? null
  const dossierTargetSection = resolved?.section ?? null
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

  // Presence probes for the Memory / Lineage evidence sub-sections inside the
  // dossier. These are empty for most tasks, so an empty sub-section is not
  // drawn (the runs sub-section gates itself on its own run count). The probes
  // run regardless of the active tab (enabled: true): they share React Query
  // cache keys with the sub-sections, so opening the dossier paints instantly —
  // and presence is derived from the *same* data each sub-section uses, so the
  // dossier can never offer a sub-section that then renders empty.
  const taskMemories = useMemories({
    scope: 'task',
    parentId: taskId,
    enabled: true,
  })
  const lineage = useTaskLineage({ identifier: taskIdentifier, enabled: true })

  // Until a probe resolves, fall back to the SSR-seeded presence so the dossier
  // paints correctly on first render (no pop-in); once a probe lands it becomes
  // the source of truth. useTaskLineage signals "not yet resolved" via
  // data===null; useMemories has no null sentinel, so its initial load is read
  // from `loading`.
  const hasMemories = taskMemories.loading
    ? (initialTimelinePresence?.hasMemories ?? false)
    : taskMemories.memories.length > 0
  const hasLineage = lineage.data
    ? lineage.data.groups.length > 0
    : (initialTimelinePresence?.hasLineage ?? false)

  // Reconcile the rendered tab with the URL: handles reload, back/forward, and
  // the case where the URL targets an unknown slug — fall back to Comments and
  // strip the dead segment from the URL (replace, so the bad URL doesn't pollute
  // history). All four tabs are always visible now (no presence-gated tab), so
  // no probe gate is needed — only the legacy slugs resolve into the dossier.
  useEffect(() => {
    if (!urlSlug) return
    if (urlTab) {
      setActiveTab(urlTab)
    } else {
      setActiveTab('comments')
      router.replace(basePath, { scroll: false })
    }
  }, [urlTab, urlSlug, basePath, router])

  // Switch tab: instant client switch (optimistic) + URL update so back/forward
  // and deep links work. Comments is the default tab → bare URL, no segment.
  const selectTab = (tab: TabValue) => {
    setActiveTab(tab)
    const target =
      tab === 'comments' ? basePath : `${basePath}/${TAB_SLUGS[tab]}`
    router.push(target, { scroll: false })
  }

  // WorkspaceMember.id → display name, so the Memory sub-section can show
  // "Added by X" for manually-created memories (createdByMemberId is an id).
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
          className={tabClass(activeTab === 'dossier')}
          onClick={() => selectTab('dossier')}
        >
          {intl.formatMessage({
            id: 'task.dossier',
            defaultMessage: 'Record',
          })}
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
      {activeTab === 'dossier' && (
        <TaskDossier
          taskId={taskId}
          taskIdentifier={taskIdentifier}
          taskStatus={taskStatus}
          agentStatus={agentStatus}
          workspaceUrl={workspaceUrl}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
          enabled={activeTab === 'dossier'}
          memberNames={memoryMemberNames}
          hasLineage={hasLineage}
          hasMemories={hasMemories}
          targetSection={dossierTargetSection}
        />
      )}
    </div>
  )
}
