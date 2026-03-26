import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { TaskDetailPage } from '../../components/pages/TaskDetailPage'

export default async function TaskIdentifierPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; identifier: string }>
}) {
  const { workspaceUrl, identifier } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Verify workspace membership
  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  // Parse and validate identifier (e.g. "ENG-42")
  const match = identifier.match(/^([A-Z]+)-(\d+)$/)
  if (!match || !match[1] || !match[2]) notFound()
  const teamIdentifier = match[1]
  const number = parseInt(match[2], 10)

  // Fetch task — workspaceId is the security boundary
  const rawTask = await prisma.task.findFirst({
    where: {
      number,
      team: { identifier: teamIdentifier, workspaceId: workspace.id },
    },
    include: {
      project: { select: { id: true, name: true, defaultReviewerId: true } },
      assignee: { select: { id: true, clerkId: true } },
      children: { select: { id: true, title: true, number: true } },
    },
  })
  if (!rawTask) notFound()

  // Serialize Dates — Next.js cannot pass Date objects from server to client components
  const task = {
    ...rawTask,
    updatedAt: rawTask.updatedAt.toISOString(),
  }

  return <TaskDetailPage initialTask={task} workspaceUrl={workspaceUrl} />
}
