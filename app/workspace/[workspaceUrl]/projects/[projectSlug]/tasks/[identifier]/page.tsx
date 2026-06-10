import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { TaskDetailPage } from '../../../../components/pages/TaskDetailPage'

export default async function ProjectTaskIdentifierPage({
  params,
}: {
  params: Promise<{
    workspaceUrl: string
    projectSlug: string
    identifier: string
  }>
}) {
  const { workspaceUrl, identifier } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
    include: { slackIntegration: { select: { id: true } } },
  })
  if (!workspace) redirect('/onboarding')

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
      children: {
        select: { id: true, title: true, number: true, status: true },
        orderBy: { number: 'asc' },
      },
      team: { select: { identifier: true } },
      sprint: { select: { id: true, name: true, status: true } },
      milestone: { select: { id: true, name: true, status: true } },
    },
  })
  if (!rawTask) notFound()

  // Compute the rare-tab presence server-side so the tab bar paints on first
  // render instead of popping in after the client probes round-trip (LUM-321).
  const initialTimelinePresence =
    await taskTimelinePresenceService.getPresence(rawTask.id)

  const task = {
    ...rawTask,
    teamIdentifier: rawTask.team.identifier,
    updatedAt: rawTask.updatedAt.toISOString(),
    createdAt: rawTask.createdAt.toISOString(),
  } as Parameters<typeof TaskDetailPage>[0]['initialTask']

  return (
    <TaskDetailPage
      initialTask={task}
      workspaceUrl={workspaceUrl}
      slackConnected={workspace.slackIntegration !== null}
      initialTimelinePresence={initialTimelinePresence}
    />
  )
}
