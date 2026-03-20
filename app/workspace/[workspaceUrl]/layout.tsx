import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { WorkspaceLayoutClient } from './layout-client'

/**
 * WorkspaceLayout — Server Component.
 * Validates workspace access, then renders client layout.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const { userId } = await auth()

  if (!userId) redirect('/signin')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })

  if (!workspace) redirect('/workspace')

  return (
    <WorkspaceLayoutClient
      workspaceUrl={workspaceUrl}
      workspaceId={workspace.id}
    >
      {children}
    </WorkspaceLayoutClient>
  )
}
