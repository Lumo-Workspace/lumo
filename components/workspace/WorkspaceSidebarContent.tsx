'use client'

import { useState } from 'react'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar'
import { DocumentList } from '@/components/features/document-management/DocumentList'
import { useDocumentCreator } from '@/components/features/document-management/DocumentCreator'
import { FilePlus } from 'lucide-react'

interface WorkspaceSidebarContentProps {
  workspaceUrl: string
  workspaceId: string
  currentDocumentId?: string | null | undefined
  onDocumentSelect?: ((documentId: string) => void) | undefined
  onDocumentCreate?: ((documentId: string) => void) | undefined
}

export function WorkspaceSidebarContent({
  workspaceId,
  currentDocumentId,
  onDocumentSelect,
  onDocumentCreate,
}: WorkspaceSidebarContentProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const { createDocument } = useDocumentCreator({
    workspaceId,
    onCreate: documentId => {
      setIsCreating(false)
      setRefreshTrigger(prev => prev + 1) // Trigger document list refresh
      onDocumentCreate?.(documentId)
      onDocumentSelect?.(documentId)
    },
  })

  const handleCreateFile = async () => {
    try {
      setIsCreating(true)
      await createDocument()
    } catch (err) {
      setIsCreating(false)
    }
  }

  return (
    <ShadcnSidebar collapsible='icon'>
      <SidebarHeader />
      <SidebarContent>
        {/* Empty group for top-level actions */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleCreateFile}
                  className='flex items-center gap-2'
                  title='Create a file'
                  disabled={isCreating}
                >
                  <FilePlus className='h-4 w-4' />
                  <span>Create a file</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Draft</SidebarGroupLabel>
          <SidebarGroupContent>
            <DocumentList
              workspaceId={workspaceId}
              currentDocumentId={currentDocumentId}
              onDocumentSelect={onDocumentSelect}
              refreshTrigger={refreshTrigger}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent />
        </SidebarGroup>
      </SidebarContent>
    </ShadcnSidebar>
  )
}
