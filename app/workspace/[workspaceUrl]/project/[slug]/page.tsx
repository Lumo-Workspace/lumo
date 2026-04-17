import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { ProjectDetailStandalonePage } from '../../components/pages/ProjectDetailStandalonePage'
import { slugify } from '@/lib/utils/slugify'

export default async function ProjectSlugPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; slug: string }>
}) {
  const { workspaceUrl, slug } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  // Find all projects in the workspace, then match by slug or fall back to ID
  const projects = await prisma.project.findMany({
    where: { workspaceId: workspace.id },
    include: {
      _count: { select: { tasks: true } },
      tasks: { where: { status: 'IN_PROGRESS' }, select: { id: true } },
    },
  })

  const project = projects.find(p => slugify(p.name) === slug)

  if (!project) notFound()

  const { tasks: inProgressTasks, ...projectFields } = project
  const serialized = {
    ...projectFields,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    inProgressCount: inProgressTasks.length,
  }

  return (
    <ProjectDetailStandalonePage
      initialProject={serialized}
      workspaceUrl={workspaceUrl}
    />
  )
}
