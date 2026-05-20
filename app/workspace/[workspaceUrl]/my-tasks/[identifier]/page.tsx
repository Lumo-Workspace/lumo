import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { TaskDetailPage } from '../../components/pages/TaskDetailPage'
import { slugify } from '@/lib/utils/slugify'

/**
 * My Tasks task detail page: /workspace/[slug]/my-tasks/LUM-2
 *
 * If the task is not assigned to the current user, redirect to the
 * canonical project-based URL instead.
 */
export default async function MyTaskDetailPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; identifier: string }>
}) {
  const { workspaceUrl, identifier } = await params
  const { userId } = await auth()
  if (!userId) redirect('/signin')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
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
          repositories: true,
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
      reviewer: {
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
      agentRuns: {
        select: {
          id: true,
          runNumber: true,
          status: true,
          trigger: true,
          errorCode: true,
          errorMessage: true,
          summary: true,
          steps: true,
          changedFiles: true,
          durationMs: true,
          prNumber: true,
          prUrl: true,
          branchName: true,
          startedAt: true,
          finishedAt: true,
        },
        orderBy: { runNumber: 'desc' as const },
      },
    },
  })
  if (!rawTask) notFound()

  // If task is not assigned to the current user, redirect to project URL
  const isMyTask = rawTask.assignee?.member?.clerkId === userId
  if (!isMyTask) {
    redirect(
      `/workspace/${workspaceUrl}/project/${slugify(rawTask.project.name)}/tasks/${identifier}`
    )
  }

  const task = {
    ...rawTask,
    teamIdentifier: rawTask.team.identifier,
    updatedAt: rawTask.updatedAt.toISOString(),
    createdAt: rawTask.createdAt.toISOString(),
    agentRuns: rawTask.agentRuns.map(r => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      steps: r.steps as
        | { key: string; text: string; elapsedMs: number; status: string }[]
        | null,
      changedFiles: r.changedFiles as
        | { path: string; status: 'added' | 'modified' | 'deleted' }[]
        | null,
    })),
    project: {
      ...rawTask.project,
      repositories: rawTask.project.repositories?.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  } as Parameters<typeof TaskDetailPage>[0]['initialTask']

  return (
    <TaskDetailPage
      initialTask={task}
      workspaceUrl={workspaceUrl}
      source='my-tasks'
      slackConnected={workspace.slackIntegration !== null}
    />
  )
}
