import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'

export default async function AppPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/signin')
  }

  // Check if user has a workspace membership
  const membership = await prisma.workspaceMember.findFirst({
    where: { clerkId: userId },
    include: { workspace: true },
  })

  if (!membership) {
    redirect('/onboarding')
  }

  // Redirect to dashboard (Sprint 4 will add project-level routing)
  redirect('/dashboard')
}
