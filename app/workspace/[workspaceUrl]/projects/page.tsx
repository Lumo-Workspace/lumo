import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import WorkspaceApp from '../WorkspaceApp'

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const { userId } = await auth()

  if (!userId) redirect('/signin')

  const workspace = await prisma.workspace.findFirst({
    where: {
      slug: workspaceUrl,
      members: { some: { clerkId: userId, deactivatedAt: null } },
    },
  })

  if (!workspace) redirect('/onboarding')

  return <WorkspaceApp key={userId} />
}
