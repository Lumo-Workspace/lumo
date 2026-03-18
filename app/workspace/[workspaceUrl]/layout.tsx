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

  if (!userId) redirect('/sign-in')

  // Find workspace by slug
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceUrl },
  })

  if (!workspace) redirect('/dashboard')

  // Verify membership
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_clerkId: { workspaceId: workspace.id, clerkId: userId },
    },
  })

  if (!member) redirect('/dashboard')

  return (
    <WorkspaceLayoutClient
      workspaceUrl={workspaceUrl}
      workspaceId={workspace.id}
    >
      {children}
    </WorkspaceLayoutClient>
  )
}
