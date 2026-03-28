import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { slugifyProjectName } from '../../utils'

export default async function TaskIdentifierPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; identifier: string }>
}) {
  const { workspaceUrl, identifier } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  const match = identifier.match(/^([A-Z]+)-(\d+)$/)
  if (!match || !match[1] || !match[2]) notFound()
  const teamIdentifier = match[1]
  const number = parseInt(match[2], 10)

  const task = await prisma.task.findFirst({
    where: {
      number,
      team: { identifier: teamIdentifier, workspaceId: workspace.id },
    },
    include: {
      project: { select: { name: true } },
      team: { select: { identifier: true } },
    },
  })
  if (!task) notFound()

  redirect(
    `/workspace/${workspaceUrl}/project/${slugifyProjectName(task.project.name)}/tasks/${identifier}`
  )
}
