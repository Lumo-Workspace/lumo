import { redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'
import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { TaskDetailPage } from '../../../../components/pages/TaskDetailPage'
import {
  loadTaskDetail,
  toInitialTask,
} from '../../../../components/pages/loadTaskDetail'

/**
 * Project task-detail layout:
 * /workspace/[slug]/projects/[projectSlug]/tasks/LUM-2[/<tab>]
 *
 * Holds the heavy, tab-independent work (task fetch + presence + render) so
 * switching tabs doesn't re-run it — Next keeps the layout mounted and only
 * re-renders the thin `[[...tab]]/page.tsx` (LUM-460 Option B). This route has
 * no ownership redirect, so its page is an empty leaf.
 */
export default async function ProjectTaskDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceUrl: string; identifier: string }>
}) {
  const { workspaceUrl, identifier } = await params
  const userId = await getCurrentUserId()
  if (!userId) redirect('/signin')

  const { workspace, rawTask } = await loadTaskDetail(
    workspaceUrl,
    identifier,
    userId
  )

  // Compute the rare-tab presence server-side so the tab bar paints on first
  // render instead of popping in after the client probes round-trip (LUM-321).
  const initialTimelinePresence = await taskTimelinePresenceService.getPresence(
    rawTask.id
  )

  const task = toInitialTask(rawTask) as Parameters<
    typeof TaskDetailPage
  >[0]['initialTask']

  return (
    <>
      {children}
      <TaskDetailPage
        initialTask={task}
        workspaceUrl={workspaceUrl}
        slackConnected={workspace.slackIntegration !== null}
        initialTimelinePresence={initialTimelinePresence}
      />
    </>
  )
}
