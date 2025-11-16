'use client'

import { useEffect, useState } from 'react'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { FilePenLine } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface Document {
  documentId: string
  title: string
  slug: string
  path: string
  updatedAt: string
}

interface DocumentListProps {
  workspaceId: string
  currentDocumentId?: string | null | undefined
  onDocumentSelect?: ((_documentId: string) => void) | undefined
  refreshTrigger?: number // Trigger refresh when this changes
  onRenameRequest?: (_documentId: string) => void
  onDeleteRequest?: (_documentId: string) => void
}

/**
 * DocumentList - Displays list of documents in the sidebar
 * Shows documents ordered by most recently updated first
 */
export function DocumentList({
  workspaceId,
  currentDocumentId,
  onDocumentSelect,
  refreshTrigger,
  onRenameRequest,
  onDeleteRequest,
}: DocumentListProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Listen for title updates from the editor to update list immediately
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { documentId: string; title: string }
        | undefined
      if (!detail) return
      setDocuments(prev =>
        prev.map(d =>
          d.documentId === detail.documentId ? { ...d, title: detail.title } : d
        )
      )
    }
    window.addEventListener('document:title-updated', handler as EventListener)
    return () =>
      window.removeEventListener(
        'document:title-updated',
        handler as EventListener
      )
  }, [])

  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(
          `/api/documents?workspaceId=${workspaceId}&limit=50`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch documents')
        }

        const data = await response.json()
        setDocuments(data)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load documents'
        )
      } finally {
        setLoading(false)
      }
    }

    if (workspaceId) {
      fetchDocuments()
    }
  }, [workspaceId, refreshTrigger])

  const handleDocumentClick = (documentId: string) => {
    onDocumentSelect?.(documentId)
  }

  if (loading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className='px-2 py-1 text-sm text-muted-foreground'>
            Loading...
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (error) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className='px-2 py-1 text-sm text-destructive'>{error}</div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (documents.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className='px-2 py-1 text-sm text-muted-foreground'>
            No documents yet
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      {documents.map(doc => {
        const isActive = currentDocumentId === doc.documentId

        return (
          <SidebarMenuItem key={doc.documentId}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  isActive={isActive}
                  onClick={() => handleDocumentClick(doc.documentId)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-2 h-auto w-full',
                    isActive && 'bg-accent'
                  )}
                >
                  <FilePenLine className='h-4 w-4 text-muted-foreground shrink-0' />
                  <span className='text-sm font-medium truncate flex-1'>
                    {doc.title}
                  </span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
              <ContextMenuContent className='w-52'>
                <ContextMenuItem
                  onClick={() => onRenameRequest?.(doc.documentId)}
                >
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  className='text-destructive focus:text-destructive'
                  onClick={() => onDeleteRequest?.(doc.documentId)}
                >
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
