import { cache } from 'react'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'

/**
 * Shared loader for the task-detail routes (my-tasks + projects).
 *
 * Wrapped in React `cache()` so that within a single request the `[identifier]`
 * layout and its `[[...tab]]` page — which both need the task to render and to
 * decide the my-tasks ownership redirect — hit the database only once
 * (deduped by `(workspaceUrl, identifier, userId)`). Across navigations (each
 * tab switch is a fresh request) the cache resets, which is fine: the heavy
 * work lives in the layout, which Next does not re-render when only the
 * sibling `[[...tab]]` segment changes (LUM-460 Option B).
 *
 * Universal failure paths are handled here so both callers behave identically:
 *  - no workspace membership → /onboarding
 *  - malformed identifier or missing task → notFound()
 *
 * The my-tasks ownership redirect stays in the page (it needs the tab segment,
 * which the layout cannot see).
 */
export const loadTaskDetail = cache(
  async (workspaceUrl: string, identifier: string, userId: string) => {
    const workspace = await prisma.workspace.findFirst({
      where: {
        slug: workspaceUrl,
        members: { some: { clerkId: userId, deactivatedAt: null } },
      },
      include: { slackIntegration: { select: { id: true } } },
    })
    if (!workspace) redirect('/onboarding')

    // Parse identifier (e.g. "LUM-2")
    const match = identifier.match(/^([A-Z]+)-(\d+)$/)
    if (!match || !match[1] || !match[2]) notFound()
    const teamIdentifier = match[1]
    const number = parseInt(match[2], 10)

    const rawTask = await prisma.task.findFirst({
      where: {
        number,
        team: { identifier: teamIdentifier, workspaceId: workspace.id },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            ownerId: true,
          },
        },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
        team: { select: { identifier: true } },
        sprint: { select: { id: true, name: true, status: true } },
        milestone: { select: { id: true, name: true, completedAt: true } },
      },
    })
    if (!rawTask) notFound()

    return { workspace, rawTask }
  }
)

/**
 * Build the serializable `initialTask` prop for `<TaskDetailPage>` from the
 * raw Prisma task returned by {@link loadTaskDetail}.
 */
export function toInitialTask(
  rawTask: Awaited<ReturnType<typeof loadTaskDetail>>['rawTask']
) {
  return {
    ...rawTask,
    teamIdentifier: rawTask.team.identifier,
    updatedAt: rawTask.updatedAt.toISOString(),
    createdAt: rawTask.createdAt.toISOString(),
  }
}
