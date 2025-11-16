'use client'

import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar'
import {
  WorkspaceProvider,
  useWorkspace,
} from '@/components/workspace/WorkspaceContext'

interface WorkspaceLayoutClientProps {
  workspaceUrl: string
  workspaceId: string
  children: React.ReactNode
}

function WorkspaceLayoutContent({
  workspaceUrl,
  workspaceId,
  children,
}: WorkspaceLayoutClientProps) {
  const { currentDocumentId, setCurrentDocumentId } = useWorkspace()

  const handleDocumentSelect = (documentId: string) => {
    setCurrentDocumentId(documentId)
  }

  const handleDocumentCreate = (documentId: string) => {
    setCurrentDocumentId(documentId)
  }

  return (
    <div className='min-h-screen grid grid-cols-[16rem_1fr]'>
      <WorkspaceSidebar
        workspaceUrl={workspaceUrl}
        workspaceId={workspaceId}
        currentDocumentId={currentDocumentId}
        onDocumentSelect={handleDocumentSelect}
        onDocumentCreate={handleDocumentCreate}
      />
      <main className='min-h-screen bg-white'>{children}</main>
    </div>
  )
}

/**
 * Client component for workspace layout
 * Provides workspace context for document selection state
 */
export function WorkspaceLayoutClient(props: WorkspaceLayoutClientProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceLayoutContent {...props} />
    </WorkspaceProvider>
  )
}
