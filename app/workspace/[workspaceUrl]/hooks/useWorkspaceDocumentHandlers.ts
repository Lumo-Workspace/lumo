'use client'

import { useCallback, Dispatch, SetStateAction } from 'react'
import type { ApiDocument, TreeNode } from '../types'
import { CACHE_KEY } from '../constants'
import { writeCache } from '../cache'
import { documentsClient } from '@/lib/api-client'

// ── Types ───────────────────────────────────────────────────────────────────

interface DocTreeActions {
  expandPathTo: (id: string) => void
  addNode: (parentId: string | null, node: TreeNode) => void
  replaceNodeId: (oldId: string, newId: string) => void
}

interface UseWorkspaceDocumentHandlersOptions {
  workspaceUrl: string
  setDocuments: Dispatch<SetStateAction<ApiDocument[]>>
  setCurrentPage: Dispatch<SetStateAction<string>>
  setSelectedDocumentId: Dispatch<SetStateAction<string | null>>
  docTree: DocTreeActions
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWorkspaceDocumentHandlers({
  workspaceUrl,
  setDocuments,
  setCurrentPage,
  setSelectedDocumentId,
  docTree,
}: UseWorkspaceDocumentHandlersOptions) {
  const navigateToDocument = useCallback(
    (id: string) => {
      setSelectedDocumentId(id)
      setCurrentPage('document-editor')
      docTree.expandPathTo(id)
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${id}`
      )
    },
    [workspaceUrl, docTree, setSelectedDocumentId, setCurrentPage]
  )

  const handleTreeCreateChild = useCallback(
    (parentId: string | null) => {
      const tempId = `temp-${crypto.randomUUID()}`
      const node: TreeNode = {
        id: tempId,
        title: '',
        emoji: null,
        parentId,
        sortOrder: Date.now(),
        childCount: 0,
      }
      docTree.addNode(parentId, node)
      setSelectedDocumentId(tempId)
      setCurrentPage('document-editor')
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${tempId}`
      )
      // Write optimistic cache for DocumentEditorPage
      writeCache(CACHE_KEY.documentDetail(tempId), {
        id: tempId,
        title: '',
        emoji: null,
        parentId,
        content: null,
        children: [],
        shares: [],
        ancestors: [],
        visibility: 'PRIVATE',
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId: null,
        project: null,
        workspaceId: '',
        createdById: '',
        createdBy: { id: '', name: '', imageUrl: null },
      })
      // Background sync
      documentsClient
        .create<{ document: ApiDocument; ancestors?: unknown[] }>({ parentId })
        .then(data => {
          const realId = data.document.id as string
          docTree.replaceNodeId(tempId, realId)
          writeCache(CACHE_KEY.documentDetail(realId), {
            ...data.document,
            ancestors: data.ancestors ?? [],
          })
          try {
            localStorage.removeItem(CACHE_KEY.documentDetail(tempId))
          } catch {
            /* */
          }
          setSelectedDocumentId(prev => {
            if (prev === tempId) return realId
            return prev
          })
          if (window.location.pathname.includes(tempId)) {
            window.history.replaceState(
              null,
              '',
              `/workspace/${workspaceUrl}/documents/${realId}`
            )
          }
        })
    },
    [workspaceUrl, docTree, setSelectedDocumentId, setCurrentPage]
  )

  const handleNewDocument = useCallback(async () => {
    try {
      const data = await documentsClient.create<{ document: ApiDocument }>({})
      setDocuments(prev => [data.document, ...prev])
      setCurrentPage('document-editor')
      setSelectedDocumentId(data.document.id)
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${data.document.id}`
      )
    } catch {}
  }, [workspaceUrl, setDocuments, setCurrentPage, setSelectedDocumentId])

  const handleDeleteDocument = useCallback(
    async (id: string) => {
      try {
        await documentsClient.delete(id)
        setDocuments(prev => prev.filter(d => d.id !== id))
      } catch {}
    },
    [setDocuments]
  )

  return {
    navigateToDocument,
    handleTreeCreateChild,
    handleNewDocument,
    handleDeleteDocument,
  }
}
