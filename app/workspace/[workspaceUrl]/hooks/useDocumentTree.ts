'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { TreeNode } from '../types'
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

function readExpandedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CACHE_KEY.treeExpanded)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function writeExpandedIds(ids: Set<string>) {
  try {
    localStorage.setItem(CACHE_KEY.treeExpanded, JSON.stringify([...ids]))
  } catch {
    /* quota exceeded */
  }
}

function writeTreeToCache(roots: TreeNode[]) {
  writeCache(CACHE_KEY.documentTree, roots)
}

function readTreeFromCache(): TreeNode[] {
  return readCache<TreeNode[]>(CACHE_KEY.documentTree) ?? []
}

// Update the tree at `queryKey` via setQueryData, mirroring to localStorage
// so the next mount hydrates from a fresh snapshot. Returning `prev` keeps
// the query in its current state if the updater short-circuits.
function patchTree(
  queryClient: QueryClient,
  updater: (prev: TreeNode[]) => TreeNode[]
) {
  queryClient.setQueryData<TreeNode[]>(queryKeys.documents.tree(), prev => {
    const next = updater(prev ?? [])
    writeTreeToCache(next)
    return next
  })
}

export function useDocumentTree(currentDocId: string | null) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.documents.tree()

  const query = useQuery<TreeNode[]>({
    queryKey,
    queryFn: async () => {
      const params = currentDocId ? `?expandedDocId=${currentDocId}` : ''
      const data = await apiFetch<{ roots: TreeNode[] }>(
        `${API.documents.tree}${params}`
      )
      writeTreeToCache(data.roots)
      return data.roots
    },
    initialData: readTreeFromCache,
    // initialData is a localStorage snapshot — refetch on mount + on focus
    // so the tree stays close to the server.
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Memoize so `[]` doesn't get a fresh identity each render — keeps
  // downstream useEffect/useCallback deps stable when the tree is empty.
  const roots = useMemo<TreeNode[]>(() => query.data ?? [], [query.data])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    readExpandedIds()
  )

  // Persist expanded state on change.
  useEffect(() => {
    writeExpandedIds(expandedIds)
  }, [expandedIds])

  // Auto-expand the path to the current doc when data becomes available.
  useEffect(() => {
    if (!currentDocId || roots.length === 0) return
    setExpandedIds(prev => {
      const next = new Set(prev)
      let touched = false
      function findPath(nodes: TreeNode[]): boolean {
        for (const node of nodes) {
          if (node.id === currentDocId) return true
          if (node.children && findPath(node.children)) {
            if (!next.has(node.id)) {
              next.add(node.id)
              touched = true
            }
            return true
          }
        }
        return false
      }
      findPath(roots)
      return touched ? next : prev
    })
    // roots identity changes on every cache write; the inner `touched`
    // guard keeps the setter a no-op when nothing new needs expanding.
  }, [currentDocId, roots])

  // Toggle expand/collapse
  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // Lazy load children when expanding a node
  const loadChildren = useCallback(
    async (nodeId: string) => {
      patchTree(queryClient, prev =>
        updateNodeInTree(prev, nodeId, node => ({ ...node, isLoading: true }))
      )

      try {
        const data = await apiFetch<{
          documents: {
            id: string
            slug: string
            title: string
            emoji: string | null
            parentId: string | null
            sortOrder: number
            _count?: { children: number }
          }[]
        }>(`${API.documents.list}?parentId=${nodeId}`)
        const children: TreeNode[] = (data.documents ?? []).map(d => ({
          id: d.id,
          slug: d.slug,
          title: d.title,
          emoji: d.emoji,
          parentId: d.parentId,
          sortOrder: d.sortOrder,
          childCount: d._count?.children ?? 0,
        }))

        patchTree(queryClient, prev =>
          updateNodeInTree(prev, nodeId, node => ({
            ...node,
            children,
            isLoading: false,
          }))
        )
      } catch {
        patchTree(queryClient, prev =>
          updateNodeInTree(prev, nodeId, node => ({
            ...node,
            isLoading: false,
          }))
        )
      }
    },
    [queryClient]
  )

  // Expand a node (toggle + lazy load if needed)
  const expandNode = useCallback(
    (nodeId: string) => {
      const node = findNodeInTree(roots, nodeId)
      if (!node) return

      setExpandedIds(prev => {
        const next = new Set(prev)
        if (next.has(nodeId)) {
          next.delete(nodeId)
          return next
        }
        next.add(nodeId)
        return next
      })

      if (node.childCount > 0 && !node.children) {
        loadChildren(nodeId)
      }
    },
    [roots, loadChildren]
  )

  // Ensure path to a document is expanded
  const expandPathTo = useCallback(
    (docId: string) => {
      setExpandedIds(prev => {
        const next = new Set(prev)
        function findPath(nodes: TreeNode[]): boolean {
          for (const node of nodes) {
            if (node.id === docId) return true
            if (node.children && findPath(node.children)) {
              next.add(node.id)
              return true
            }
          }
          return false
        }
        findPath(roots)
        return next
      })
    },
    [roots]
  )

  // ─── Optimistic operations ──────────────────────────────────

  const addNode = useCallback(
    (parentId: string | null, node: TreeNode) => {
      patchTree(queryClient, prev => {
        if (parentId === null) return [...prev, node]
        return updateNodeInTree(prev, parentId, parent => ({
          ...parent,
          childCount: parent.childCount + 1,
          children: [...(parent.children ?? []), node],
        }))
      })
      if (parentId) {
        setExpandedIds(prev => {
          const next = new Set(prev)
          next.add(parentId)
          return next
        })
      }
    },
    [queryClient]
  )

  const removeNode = useCallback(
    (nodeId: string) => {
      patchTree(queryClient, prev => removeNodeFromTree(prev, nodeId))
    },
    [queryClient]
  )

  const renameNode = useCallback(
    (nodeId: string, title: string) => {
      patchTree(queryClient, prev =>
        updateNodeInTree(prev, nodeId, node => ({ ...node, title }))
      )
    },
    [queryClient]
  )

  const updateNodeEmoji = useCallback(
    (nodeId: string, emoji: string | null) => {
      patchTree(queryClient, prev =>
        updateNodeInTree(prev, nodeId, node => ({ ...node, emoji }))
      )
    },
    [queryClient]
  )

  const moveNode = useCallback(
    (nodeId: string, newParentId: string | null, sortOrder: number) => {
      patchTree(queryClient, prev => {
        const node = findNodeInTree(prev, nodeId)
        if (!node) return prev
        const afterRemove = removeNodeFromTree(prev, nodeId)
        const movedNode = { ...node, parentId: newParentId, sortOrder }

        if (newParentId === null) {
          return insertSorted(afterRemove, movedNode)
        }
        return updateNodeInTree(afterRemove, newParentId, parent => ({
          ...parent,
          childCount: parent.childCount + 1,
          children: insertSorted(parent.children ?? [], movedNode),
        }))
      })
    },
    [queryClient]
  )

  const replaceNodeId = useCallback(
    (tempId: string, realId: string) => {
      patchTree(queryClient, prev =>
        updateNodeInTree(prev, tempId, node => ({ ...node, id: realId }))
      )
    },
    [queryClient]
  )

  // Refresh tree from server (called from page-change side effects + after
  // subtree-creating mutations from other pages).
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient])

  return {
    roots,
    expandedIds,
    loading: query.isLoading,
    expandNode,
    toggleExpand,
    expandPathTo,
    addNode,
    removeNode,
    renameNode,
    updateNodeEmoji,
    moveNode,
    replaceNodeId,
    refresh,
  }
}

// ─── Tree utility functions ──────────────────────────────────

function findNodeInTree(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNodeInTree(node.children, id)
      if (found) return found
    }
  }
  return null
}

function updateNodeInTree(
  nodes: TreeNode[],
  id: string,
  updater: (node: TreeNode) => TreeNode
): TreeNode[] {
  return nodes.map(node => {
    if (node.id === id) return updater(node)
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, id, updater) }
    }
    return node
  })
}

function removeNodeFromTree(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes
    .filter(node => node.id !== id)
    .map(node => {
      if (node.children) {
        const filteredChildren = removeNodeFromTree(node.children, id)
        const removed = node.children.length !== filteredChildren.length
        return {
          ...node,
          children: filteredChildren,
          childCount: removed ? node.childCount - 1 : node.childCount,
        }
      }
      return node
    })
}

function insertSorted(nodes: TreeNode[], node: TreeNode): TreeNode[] {
  const result = [...nodes, node]
  result.sort((a, b) => a.sortOrder - b.sortOrder)
  return result
}
