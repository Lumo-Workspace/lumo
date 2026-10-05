import { auth } from '@clerk/nextjs/server'
import { getUserWorkspace } from '@/lib/auth'
import { SettingsShell } from './SettingsShell'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params

  // Resolve role server-side so SettingsShell renders the correct nav on first
  // paint — no client-side fetch or localStorage needed.
  const { userId } = await auth()
  let isOwner = false
  if (userId) {
    // The page's own workspace, not the user's default (LUM-987).
    const ws = await getUserWorkspace(userId, workspaceUrl)
    isOwner = ws?.member.role === 'OWNER'
  }

  return (
    <SettingsShell workspaceUrl={workspaceUrl} isOwner={isOwner}>
      {children}
    </SettingsShell>
  )
}
