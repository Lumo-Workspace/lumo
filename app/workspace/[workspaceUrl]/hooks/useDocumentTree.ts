'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { TreeNode } from '../types'
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { apiFetch } from '@/lib/api-client'

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

export function useDocumentTree(currentDocId: string | null) {
  const [roots, setRoots] = useState<TreeNode[]>(() => {
    return readCache<TreeNode[]>(CACHE_KEY.documentTree) ?? []
  })
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    readExpandedIds()
  )
  const [loading, setLoading] = useState(roots.length === 0)
  const fetchedRef = useRef(false)

  // Persist expanded state
  useEffect(() => {
    writeExpandedIds(expandedIds)
  }, [expandedIds])

  // Persist tree to cache
  const cacheTree = useCallback((tree: TreeNode[]) => {
    writeCache(CACHE_KEY.documentTree, tree)
  }, [])

  // Initial fetch
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const params = currentDocId ? `?expandedDocId=${currentDocId}` : ''
    ;(async () => {
      try {
        const data = await apiFetch<{ roots: TreeNode[] }>(
          `${API.documents.tree}${params}`
        )
        setRoots(data.roots)
        cacheTree(data.roots)

        // Auto-expand the path to current doc
        if (currentDocId) {
          setExpandedIds(prev => {
            const next = new Set(prev)
            function findPath(nodes: TreeNode[]): boolean {
              for (const node of nodes) {
                if (node.id === currentDocId) return true
                if (node.children && findPath(node.children)) {
                  next.add(node.id)
                  return true
                }
              }
              return false
            }
            findPath(data.roots)
            return next
          })
        }
      } catch {
        // Non-critical — tree keeps cached data
      } finally {
        setLoading(false)
      }
    })()
  }, [currentDocId, cacheTree])

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
      // Mark as loading
      setRoots(prev =>
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
        const children: TreeNode[] = (data.documents ?? []).map(
          (d: {
            id: string
            slug: string
            title: string
            emoji: string | null
            parentId: string | null
            sortOrder: number
            _count?: { children: number }
          }) => ({
            id: d.id,
            slug: d.slug,
            title: d.title,
            emoji: d.emoji,
            parentId: d.parentId,
            sortOrder: d.sortOrder,
            childCount: d._count?.children ?? 0,
          })
        )

        setRoots(prev => {
          const updated = updateNodeInTree(prev, nodeId, node => ({
            ...node,
            children,
            isLoading: false,
          }))
          cacheTree(updated)
          return updated
        })
      } catch {
        setRoots(prev =>
          updateNodeInTree(prev, nodeId, node => ({
            ...node,
            isLoading: false,
          }))
        )
      }
    },
    [cacheTree]
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

      // Lazy load if no children loaded yet but has children
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
      setRoots(prev => {
        if (parentId === null) {
          const updated = [...prev, node]
          cacheTree(updated)
          return updated
        }
        const updated = updateNodeInTree(prev, parentId, parent => ({
          ...parent,
          childCount: parent.childCount + 1,
          children: [...(parent.children ?? []), node],
        }))
        cacheTree(updated)
        return updated
      })
      if (parentId) {
        setExpandedIds(prev => {
          const next = new Set(prev)
          next.add(parentId)
          return next
        })
      }
    },
    [cacheTree]
  )

  const removeNode = useCallback(
    (nodeId: string) => {
      setRoots(prev => {
        const updated = removeNodeFromTree(prev, nodeId)
        cacheTree(updated)
        return updated
      })
    },
    [cacheTree]
  )

  const renameNode = useCallback(
    (nodeId: string, title: string) => {
      setRoots(prev => {
        const updated = updateNodeInTree(prev, nodeId, node => ({
          ...node,
          title,
        }))
        cacheTree(updated)
        return updated
      })
    },
    [cacheTree]
  )

  const updateNodeEmoji = useCallback(
    (nodeId: string, emoji: string | null) => {
      setRoots(prev => {
        const updated = updateNodeInTree(prev, nodeId, node => ({
          ...node,
          emoji,
        }))
        cacheTree(updated)
        return updated
      })
    },
    [cacheTree]
  )

  const moveNode = useCallback(
    (nodeId: string, newParentId: string | null, sortOrder: number) => {
      setRoots(prev => {
        // Remove from old position
        const node = findNodeInTree(prev, nodeId)
        if (!node) return prev
        const afterRemove = removeNodeFromTree(prev, nodeId)
        const movedNode = { ...node, parentId: newParentId, sortOrder }

        // Insert at new position
        if (newParentId === null) {
          const updated = insertSorted(afterRemove, movedNode)
          cacheTree(updated)
          return updated
        }
        const updated = updateNodeInTree(afterRemove, newParentId, parent => ({
          ...parent,
          childCount: parent.childCount + 1,
          children: insertSorted(parent.children ?? [], movedNode),
        }))
        cacheTree(updated)
        return updated
      })
    },
    [cacheTree]
  )

  const replaceNodeId = useCallback(
    (tempId: string, realId: string) => {
      setRoots(prev => {
        const updated = updateNodeInTree(prev, tempId, node => ({
          ...node,
          id: realId,
        }))
        cacheTree(updated)
        return updated
      })
    },
    [cacheTree]
  )

  // Refresh tree from server
  const refresh = useCallback(async () => {
    try {
      const params = currentDocId ? `?expandedDocId=${currentDocId}` : ''
      const data = await apiFetch<{ roots: TreeNode[] }>(
        `${API.documents.tree}${params}`
      )
      setRoots(data.roots)
      cacheTree(data.roots)
    } catch {
      // Non-critical — tree keeps current data
    }
  }, [currentDocId, cacheTree])

  // Refresh tree on window focus
  useEffect(() => {
    const handleFocus = () => {
      refresh()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])

  return {
    roots,
    expandedIds,
    loading,
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
