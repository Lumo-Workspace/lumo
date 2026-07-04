'use client'

import { useCallback, Dispatch, SetStateAction } from 'react'
import type { ApiDocument, TreeNode } from '../types'
import { CACHE_KEY } from '../constants'
import { writeCache } from '../cache'
import { documentsClient } from '@/lib/api-client'
import { TEMP_DOC_ID_PREFIX } from '../utils/tempDocId'

// ── Types ───────────────────────────────────────────────────────────────────

interface DocTreeActions {
  expandPathTo: (id: string) => void
  addNode: (parentId: string | null, node: TreeNode) => void
  removeNode: (nodeId: string) => void
  replaceNodeId: (oldId: string, newId: string) => void
}

/** Minimal current-user shape needed to seed the optimistic createdBy field. */
interface OptimisticAuthor {
  displayName: string
  imageUrl: string | null
}

interface UseWorkspaceDocumentHandlersOptions {
  workspaceUrl: string
  setDocuments: Dispatch<SetStateAction<ApiDocument[]>>
  setCurrentPage: Dispatch<SetStateAction<string>>
  setSelectedDocumentId: Dispatch<SetStateAction<string | null>>
  docTree: DocTreeActions
  currentUser: OptimisticAuthor | null
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWorkspaceDocumentHandlers({
  workspaceUrl,
  setDocuments,
  setCurrentPage,
  setSelectedDocumentId,
  docTree,
  currentUser,
}: UseWorkspaceDocumentHandlersOptions) {
  /**
   * Navigate to a document by its URL identifier — `slug` for real docs,
   * the optimistic `temp-uuid` string for docs still in flight from
   * `handleTreeCreateChild`. Internally `selectedDocumentId` (the existing
   * state name) holds this same identifier; everything downstream
   * (`/api/documents/<segment>`, the cache key) takes either.
   */
  const navigateToDocument = useCallback(
    (slugOrTempId: string) => {
      setSelectedDocumentId(slugOrTempId)
      setCurrentPage('document-editor')
      docTree.expandPathTo(slugOrTempId)
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${slugOrTempId}`
      )
    },
    [workspaceUrl, docTree, setSelectedDocumentId, setCurrentPage]
  )

  const navigateToDocuments = useCallback(() => {
    setCurrentPage('documents')
    window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents`)
  }, [workspaceUrl, setCurrentPage])

  const handleTreeCreateChild = useCallback(
    (
      parentId: string | null,
      template?: { id: string; content: string; emoji: string | null }
    ) => {
      const tempId = `${TEMP_DOC_ID_PREFIX}${crypto.randomUUID()}`
      const node: TreeNode = {
        id: tempId,
        slug: null,
        title: '',
        emoji: template?.emoji ?? null,
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
        number: 0,
        slug: tempId,
        title: '',
        emoji: template?.emoji ?? null,
        parentId,
        content: template?.content ?? null,
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
        createdBy: {
          id: '',
          name: currentUser?.displayName ?? '',
          imageUrl: currentUser?.imageUrl ?? null,
        },
      })
      // Background sync — carry templateId so the server injects the skeleton.
      documentsClient
        .create<{
          document: ApiDocument
          ancestors?: unknown[]
        }>(template ? { parentId, templateId: template.id } : { parentId })
        .then(data => {
          // Swap the optimistic identifier (`temp-uuid`) for the real slug.
          // We index the tree by id (stable cuid, never collides) and route
          // the URL by slug (regenerated on title change); the same slug is
          // also what /api/documents/<segment> expects.
          const realSlug = data.document.slug
          const realId = data.document.id
          docTree.replaceNodeId(tempId, realId)
          writeCache(CACHE_KEY.documentDetail(realSlug), {
            ...data.document,
            ancestors: data.ancestors ?? [],
          })
          try {
            localStorage.removeItem(CACHE_KEY.documentDetail(tempId))
          } catch {
            /* */
          }
          // Mirror into the flat documents list that powers the Doc home page,
          // so the new doc shows up there as well as in the tree.
          setDocuments(prev => [data.document, ...prev])
          setSelectedDocumentId(prev => {
            if (prev === tempId) return realSlug
            return prev
          })
          if (window.location.pathname.includes(tempId)) {
            window.history.replaceState(
              null,
              '',
              `/workspace/${workspaceUrl}/documents/${realSlug}`
            )
          }
        })
    },
    [
      workspaceUrl,
      docTree,
      setDocuments,
      setSelectedDocumentId,
      setCurrentPage,
      currentUser,
    ]
  )

  // Doc home page "+ New document" — reuse the tree's optimistic flow so the
  // user sees the editor instantly instead of waiting for the create round-trip
  // (which includes a Clerk lookup on the server).
  const handleNewDocument = useCallback(() => {
    handleTreeCreateChild(null)
  }, [handleTreeCreateChild])

  // Optimistic delete — mirrors the sidebar delete flow: remove locally from
  // both the documents list and the tree immediately, then fire-and-forget
  // the API call.
  const handleDeleteDocument = useCallback(
    (id: string) => {
      setDocuments(prev => prev.filter(d => d.id !== id))
      docTree.removeNode(id)
      documentsClient.delete(id).catch(() => {
        /* best-effort */
      })
    },
    [setDocuments, docTree]
  )

  return {
    navigateToDocument,
    navigateToDocuments,
    handleTreeCreateChild,
    handleNewDocument,
    handleDeleteDocument,
  }
}
