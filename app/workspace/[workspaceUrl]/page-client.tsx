'use client'

import { DocumentEditor } from '@/components/features/document-management/DocumentEditor'
import { useWorkspace } from '@/components/workspace/WorkspaceContext'

interface WorkspacePageClientProps {
  workspaceId: string
}

/**
 * Client component for workspace page
 * Uses workspace context to get current document ID
 */
export function WorkspacePageClient({ workspaceId }: WorkspacePageClientProps) {
  const { currentDocumentId } = useWorkspace()

  return (
    <DocumentEditor documentId={currentDocumentId} workspaceId={workspaceId} />
  )
}
