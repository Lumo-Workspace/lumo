'use client'

import { SidebarProvider } from '@/components/ui/sidebar'
import { WorkspaceSidebarContent } from './WorkspaceSidebarContent'

interface WorkspaceSidebarProps {
  workspaceUrl: string
  workspaceId: string
  currentDocumentId?: string | null | undefined
  onDocumentSelect?: ((documentId: string) => void) | undefined
  onDocumentCreate?: ((documentId: string) => void) | undefined
}

export function WorkspaceSidebar({
  workspaceUrl,
  workspaceId,
  currentDocumentId,
  onDocumentSelect,
  onDocumentCreate,
}: WorkspaceSidebarProps) {
  return (
    <SidebarProvider>
      <WorkspaceSidebarContent
        workspaceUrl={workspaceUrl}
        workspaceId={workspaceId}
        {...(currentDocumentId !== undefined && { currentDocumentId })}
        {...(onDocumentSelect && { onDocumentSelect })}
        {...(onDocumentCreate && { onDocumentCreate })}
      />
    </SidebarProvider>
  )
}

export default WorkspaceSidebar
