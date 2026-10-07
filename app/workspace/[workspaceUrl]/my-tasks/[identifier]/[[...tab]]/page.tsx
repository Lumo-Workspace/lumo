import { redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'
import { loadTaskDetail } from '../../../components/pages/loadTaskDetail'
import { buildMyTaskRedirectPath } from '../../../utils/taskPath'

/**
 * My Tasks task-detail page: /workspace/[slug]/my-tasks/LUM-2[/<tab>]
 *
 * Thin by design (LUM-460 Option B): the task fetch + presence + render live in
 * the sibling `[identifier]/layout.tsx`, which stays mounted across tab
 * switches. This page only guards ownership — if the task isn't assigned to the
 * current user, redirect to the canonical projects URL, carrying the active tab
 * segment through so a shared deep link survives the canonical hop (follow-up
 * 2). The shared loader is memoized, so on first render this reuses the layout's
 * fetch rather than hitting the database again.
 */
export default async function MyTaskDetailPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; identifier: string; tab?: string[] }>
}) {
  const { workspaceUrl, identifier, tab } = await params
  const userId = await getCurrentUserId()
  if (!userId) redirect('/signin')

  const { rawTask } = await loadTaskDetail(workspaceUrl, identifier, userId)

  const isMyTask = rawTask.assignee?.member?.clerkId === userId
  if (!isMyTask) {
    redirect(
      buildMyTaskRedirectPath(
        workspaceUrl,
        rawTask.project.name,
        identifier,
        tab
      )
    )
  }

  return null
}
