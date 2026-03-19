import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { WorkspacePageClient } from './page-client'

/**
 * WorkspaceAppPage — Server Component.
 * Sprint 4 will add full project routing.
 */
export default async function WorkspaceAppPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const { userId } = await auth()

  if (!userId) redirect('/signin')

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceUrl },
  })

  if (!workspace) redirect('/dashboard')

  return <WorkspacePageClient workspaceId={workspace.id} />
}
