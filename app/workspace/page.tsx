import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { getUserWorkspace } from '@/lib/auth'

export default async function WorkspaceIndexPage() {
  const { userId } = await auth()

  if (!userId) redirect('/signin')

  // No slug here: the user's default (oldest) workspace, deterministic (LUM-987).
  const ws = await getUserWorkspace(userId, null)

  if (!ws) redirect('/onboarding')

  redirect(`/workspace/${ws.workspace.slug}`)
}
