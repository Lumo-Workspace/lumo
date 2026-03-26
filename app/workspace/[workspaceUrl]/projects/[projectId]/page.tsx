import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { ProjectDetailStandalonePage } from '../../components/pages/ProjectDetailStandalonePage'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; projectId: string }>
}) {
  const { workspaceUrl, projectId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Verify workspace membership
  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  // Fetch project — workspaceId is the security boundary
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: workspace.id },
  })
  if (!project) notFound()

  // Serialize Dates — Next.js cannot pass Date objects from server to client
  const serialized = {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }

  return (
    <ProjectDetailStandalonePage
      initialProject={serialized}
      workspaceUrl={workspaceUrl}
    />
  )
}
