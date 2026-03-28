import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { slugifyProjectName } from '../../utils'

export default async function LegacyProjectPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; projectId: string }>
}) {
  const { workspaceUrl, projectId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: workspace.id },
    select: { name: true },
  })
  if (!project) notFound()

  redirect(
    `/workspace/${workspaceUrl}/project/${slugifyProjectName(project.name)}`
  )
}
