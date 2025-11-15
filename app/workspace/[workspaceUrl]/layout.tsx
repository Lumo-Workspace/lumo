import { getWorkspaceData } from '@/lib/workspace/get-workspace-data'
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar'

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
  await getWorkspaceData(workspaceUrl)

  return (
    <div className='min-h-screen grid grid-cols-[16rem_1fr]'>
      <WorkspaceSidebar workspaceUrl={workspaceUrl} />
      <main className='min-h-screen bg-white'>{children}</main>
    </div>
  )
}
