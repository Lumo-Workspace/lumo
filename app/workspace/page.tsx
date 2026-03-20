import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'

export default async function WorkspaceIndexPage() {
  const { userId } = await auth()

  if (!userId) redirect('/signin')

  const membership = await prisma.workspaceMember.findFirst({
    where: { clerkId: userId },
    include: { workspace: true },
  })

  if (!membership) redirect('/onboarding')

  redirect(`/workspace/${membership.workspace.slug}`)
}
