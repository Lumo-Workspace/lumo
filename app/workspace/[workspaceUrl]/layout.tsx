import { getWorkspaceData } from '@/lib/workspace/get-workspace-data'
import { WorkspaceLayoutClient } from './layout-client'

/**
 * WorkspaceLayout - Server Component Layout
 * Follows Next.js 16 patterns:
 * - Server Component by default
 * - params is a Promise (must await)
 * - Reuses server-side data fetching logic
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params

  // Server-side auth and authorization check
  const workspaceData = await getWorkspaceData(workspaceUrl)

  return (
    <WorkspaceLayoutClient
      workspaceUrl={workspaceUrl}
      workspaceId={workspaceData.workspace.id}
    >
      {children}
    </WorkspaceLayoutClient>
  )
}
