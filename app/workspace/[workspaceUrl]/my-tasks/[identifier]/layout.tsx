import { redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'
import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { TaskDetailPage } from '../../components/pages/TaskDetailPage'
import {
  loadTaskDetail,
  toInitialTask,
} from '../../components/pages/loadTaskDetail'

/**
 * My Tasks task-detail layout: /workspace/[slug]/my-tasks/LUM-2[/<tab>]
 *
 * The heavy, tab-independent work — task fetch + timeline-presence + the
 * <TaskDetailPage> render — lives here so switching tabs (a sibling
 * `[[...tab]]` navigation) does not re-run it; Next keeps this layout mounted
 * and only re-renders the thin page (LUM-460 Option B). `{children}` is the
 * `[[...tab]]/page.tsx`, which stays mounted to run the ownership redirect for
 * non-owned tasks (it needs the tab segment the layout can't see).
 */
export default async function MyTaskDetailLayout({
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
        source='my-tasks'
        slackConnected={workspace.slackIntegration !== null}
        initialTimelinePresence={initialTimelinePresence}
      />
    </>
  )
}
