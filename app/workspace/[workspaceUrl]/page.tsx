import { getWorkspaceData } from '@/lib/workspace/get-workspace-data'
import RichTextEditor from '@/components/core/editor/rich-text/RichTextEditor'

/**
 * WorkspaceAppPage - Server Component
 * Follows Next.js 16 patterns:
 * - params is a Promise (must await)
 * - Server Component by default (no 'use client')
 * - Data fetching at the component level
 */
export default async function WorkspaceAppPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params

  // Server-side data fetching and auth checks
  await getWorkspaceData(workspaceUrl)

  return (
    <div className='min-h-screen bg-white'>
      <RichTextEditor />
    </div>
  )
}
