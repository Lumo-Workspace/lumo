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
import { DecisionsTab } from './DecisionsTab'
import { useTaskDecisions } from '../../hooks/useTaskDecisions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  /** Comment count (incl. replies) shown as a quiet number on the Comments
   *  tab; omitted or 0 shows no number. */
  commentCount?: number | undefined
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
  commentCount,
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
  // LUM-1303: always on (one small list) so the tab shows its count; shares
  // the cache key with the tab itself.
  const decisionCount = useTaskDecisions(taskId).decisions.length

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
  // history). All tabs are always visible now (no presence-gated tab), so
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
  // LUM-1303: WorkspaceMember.id → name + avatar for the Decisions cards.
  const decisionAuthors = useMemo(
    () =>
      new Map(
        commentsProps.members.map(m => [
          m.id,
          { name: m.name, imageUrl: m.imageUrl },
        ])
      ),
    [commentsProps.members]
  )

  const tabs: { value: TabValue; label: string; count?: number | undefined }[] =
    [
      {
        value: 'comments',
        label: intl.formatMessage({
          id: 'task.comments',
          defaultMessage: 'Comments',
        }),
        count: commentCount,
      },
      {
        value: 'activity',
        label: intl.formatMessage({
          id: 'task.activity',
          defaultMessage: 'Activity',
        }),
      },
      {
        value: 'context',
        label: intl.formatMessage({
          id: 'task.context.tab',
          defaultMessage: 'Context',
        }),
      },
      {
        value: 'decisions',
        label: intl.formatMessage({
          id: 'task.decisions.tab',
          defaultMessage: 'Decisions',
        }),
        count: decisionCount,
      },
      {
        value: 'dossier',
        label: intl.formatMessage({
          id: 'task.dossier',
          defaultMessage: 'Record',
        }),
      },
    ]

  // LUM-1274: the shared Tabs primitive (roving focus + arrow keys). The
  // active value stays URL-driven: a change goes through selectTab, which
  // pushes the tab's path segment. Radix mounts only the active panel, exactly
  // as the old conditional render did, so inactive tabs never fetch.
  return (
    <Tabs
      value={activeTab}
      onValueChange={v => selectTab(v as TabValue)}
      className='mt-10'
    >
      <TabsList>
        {tabs.map(tab => (
          <TabsTrigger key={tab.value} value={tab.value} className='gap-1.5'>
            {tab.label}
            {tab.count ? (
              <span className='text-caption tabular-nums text-muted-foreground'>
                {tab.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value='activity' className='mt-6'>
        <ActivityTimeline
          entries={timeline.entries}
          loading={timeline.loading}
          hasMore={timeline.hasMore}
          loadingMore={timeline.loadingMore}
          onLoadMore={timeline.loadMore}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
        />
      </TabsContent>
      <TabsContent value='comments' className='mt-6'>
        <TaskDetailComments {...commentsProps} />
      </TabsContent>
      <TabsContent value='context' className='mt-6'>
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
      </TabsContent>
      <TabsContent value='decisions' className='mt-6'>
        <DecisionsTab
          taskId={taskId}
          authors={decisionAuthors}
          enabled={activeTab === 'decisions'}
        />
      </TabsContent>
      <TabsContent value='dossier' className='mt-6'>
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
      </TabsContent>
    </Tabs>
  )
}
