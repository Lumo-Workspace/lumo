'use client'

import { useCallback } from 'react'

interface UseDocumentCreatorOptions {
  workspaceId: string
  onCreate: (documentId: string) => void
}

/**
 * Hook for document creation
 * Creates documents with default title "Untitled"
 */
export function useDocumentCreator({
  workspaceId,
  onCreate,
}: UseDocumentCreatorOptions) {
  const createDocument = useCallback(async () => {
    try {
      // Default title: "Untitled" (no timestamp)
      const defaultTitle = 'Untitled'

      // Default TipTap content (empty document with H1)
      const defaultContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: '' }],
          },
        ],
      }

      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title: defaultTitle,
          content: defaultContent,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create document')
      }

      const data = await response.json()
      onCreate(data.documentId)
      return data.documentId
    } catch (err) {
      console.error('Failed to create document:', err)
      throw err
    }
  }, [workspaceId, onCreate])

  return { createDocument }
}
