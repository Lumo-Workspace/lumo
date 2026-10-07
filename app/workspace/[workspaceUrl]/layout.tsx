import { redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { IntlWrapper } from './IntlWrapper'

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
  const userId = await getCurrentUserId()

  if (!userId) redirect('/signin')

  const workspace = await prisma.workspace.findFirst({
    where: {
      slug: workspaceUrl,
      members: { some: { clerkId: userId, deactivatedAt: null } },
    },
  })

  if (!workspace) redirect('/workspace')

  return <IntlWrapper>{children}</IntlWrapper>
}
