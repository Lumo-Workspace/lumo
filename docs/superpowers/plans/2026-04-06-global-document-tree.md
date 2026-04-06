# Global Document Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-document TOC sidebar with a global document tree (Feishu/Lark style) that persists across page navigations, supports lazy loading and cross-parent drag-and-drop.

**Architecture:** New `/api/documents/tree` endpoint returns root nodes with 2 levels + expanded path. Tree state lives in WorkspaceApp via a `useDocumentTree` hook, independent of DocumentEditorPage. GlobalDocTree component renders the recursive tree with vertical connector lines and cross-parent drag-and-drop.

**Tech Stack:** Next.js 14 App Router, Prisma, React state + localStorage caching, HTML5 drag-and-drop, shadcn/ui ContextMenu.

**Spec:** `docs/superpowers/specs/2026-04-06-global-document-tree-design.md`

---

## File Structure

| File                                                                   | Action | Responsibility                                                                                 |
| ---------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/types.ts`                                | Modify | Add `TreeNode` type                                                                            |
| `app/workspace/[workspaceUrl]/constants.ts`                            | Modify | Add `API.documents.tree`, `CACHE_KEY.documentTree`, `CACHE_KEY.treeExpanded`                   |
| `app/api/documents/tree/route.ts`                                      | Create | GET endpoint: roots + 2 levels + expanded path                                                 |
| `app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts`                | Create | Global tree state management hook (fetch, cache, expand, collapse, optimistic CRUD)            |
| `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx`   | Create | Tree sidebar component with Feishu-style connector lines, drag-and-drop                        |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                        | Modify | Use `useDocumentTree`, render GlobalDocTree instead of passing tree data to DocumentEditorPage |
| `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` | Modify | Remove tree/ancestor state, TOC rendering, rename/delete dialogs (moved to WorkspaceApp)       |
| `app/workspace/[workspaceUrl]/components/document/DocumentTOC.tsx`     | Delete | Replaced by GlobalDocTree                                                                      |

---

### Task 1: Types and Constants

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`

- [ ] **Step 1: Add TreeNode type to types.ts**

Add after the existing `ApiDocumentAncestor` interface:

```typescript
export interface TreeNode {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  sortOrder: number
  childCount: number
  children?: TreeNode[]
  isLoading?: boolean
}
```

- [ ] **Step 2: Add API and cache constants**

In `constants.ts`, add to the `API.documents` object:

```typescript
tree: '/api/documents/tree',
```

Add to the `CACHE_KEY` object:

```typescript
documentTree: 'lumo:document-tree',
treeExpanded: 'lumo:tree-expanded',
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`
Expected: No new errors (only pre-existing similarity.test.ts errors)

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/types.ts" "app/workspace/[workspaceUrl]/constants.ts"
git commit -m "feat: add TreeNode type and tree API/cache constants [LUM-15]"
```

---

### Task 2: Tree API Endpoint

**Files:**

- Create: `app/api/documents/tree/route.ts`

- [ ] **Step 1: Create the tree endpoint**

Create `app/api/documents/tree/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'

const TREE_SELECT = {
  id: true,
  title: true,
  emoji: true,
  parentId: true,
  sortOrder: true,
  _count: { select: { children: true } },
} as const

interface RawNode {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  sortOrder: number
  _count: { children: number }
}

interface TreeNodeResponse {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  sortOrder: number
  childCount: number
  children?: TreeNodeResponse[]
}

function toTreeNode(
  raw: RawNode,
  children?: TreeNodeResponse[]
): TreeNodeResponse {
  return {
    id: raw.id,
    title: raw.title,
    emoji: raw.emoji,
    parentId: raw.parentId,
    sortOrder: raw.sortOrder,
    childCount: raw._count.children,
    children,
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const expandedDocId = request.nextUrl.searchParams.get('expandedDocId')

  // 1. Build the expanded path (ancestors of expandedDocId)
  const expandedPath = new Set<string>()
  if (expandedDocId) {
    let currentId: string | null = expandedDocId
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const doc = await prisma.document.findUnique({
        where: { id: currentId },
        select: { id: true, parentId: true },
      })
      if (!doc) break
      expandedPath.add(doc.id)
      currentId = doc.parentId
    }
  }

  // 2. Fetch root documents
  const roots = await prisma.document.findMany({
    where: { workspaceId: ws.workspaceId, parentId: null },
    orderBy: { sortOrder: 'asc' },
    select: TREE_SELECT,
  })

  // 3. Build tree with depth 2 + expanded path
  async function buildNode(
    raw: RawNode,
    depth: number
  ): Promise<TreeNodeResponse> {
    const shouldExpand = depth < 2 || expandedPath.has(raw.id)
    if (!shouldExpand || raw._count.children === 0) {
      return toTreeNode(raw)
    }

    const childDocs = await prisma.document.findMany({
      where: { parentId: raw.id },
      orderBy: { sortOrder: 'asc' },
      select: TREE_SELECT,
    })

    const children = await Promise.all(
      childDocs.map(child => buildNode(child, depth + 1))
    )

    return toTreeNode(raw, children)
  }

  const tree = await Promise.all(roots.map(root => buildNode(root, 0)))

  return NextResponse.json({ roots: tree })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add "app/api/documents/tree/route.ts"
git commit -m "feat: add /api/documents/tree endpoint with lazy expansion [LUM-15]"
```

---

### Task 3: useDocumentTree Hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts`

- [ ] **Step 1: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts`:

```typescript
'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { TreeNode } from '../types'
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'

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
    fetch(`${API.documents.tree}${params}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.roots) {
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
        }
      })
      .finally(() => setLoading(false))
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
        const res = await fetch(`${API.documents.list}?parentId=${nodeId}`)
        if (!res.ok) return
        const data = await res.json()
        const children: TreeNode[] = (data.documents ?? []).map(
          (d: {
            id: string
            title: string
            emoji: string | null
            parentId: string | null
            sortOrder: number
            _count?: { children: number }
          }) => ({
            id: d.id,
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
    const params = currentDocId ? `?expandedDocId=${currentDocId}` : ''
    const res = await fetch(`${API.documents.tree}${params}`)
    if (!res.ok) return
    const data = await res.json()
    if (data?.roots) {
      setRoots(data.roots)
      cacheTree(data.roots)
    }
  }, [currentDocId, cacheTree])

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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add "app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts"
git commit -m "feat: add useDocumentTree hook with optimistic CRUD [LUM-15]"
```

---

### Task 4: GlobalDocTree Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx`

- [ ] **Step 1: Create the component**

Create `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx`:

```typescript
'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { FileText, Plus, ChevronRight, Pencil, Trash2, Loader2 } from 'lucide-react'
import type { TreeNode } from '../../types'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface GlobalDocTreeProps {
  roots: TreeNode[]
  expandedIds: Set<string>
  currentDocId: string | null
  onNavigate: (id: string) => void
  onExpandNode: (id: string) => void
  onAddChild: (parentId: string | null) => void
  onRenameDoc: (doc: { id: string; title: string }) => void
  onDeleteDoc: (doc: { id: string; title: string }) => void
  onMoveNode: (nodeId: string, newParentId: string | null, sortOrder: number) => void
}

// ─── Drop position ──────────────────────────────────────────

type DropPosition = 'before' | 'inside' | 'after'

interface DropTarget {
  nodeId: string
  position: DropPosition
}

// ─── Tree Item Row ──────────────────────────────────────────

function TreeItemRow({
  node,
  depth,
  isExpanded,
  isCurrent,
  draggedId,
  dropTarget,
  onToggleExpand,
  onClick,
  onAddChild,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  node: TreeNode
  depth: number
  isExpanded: boolean
  isCurrent: boolean
  draggedId: string | null
  dropTarget: DropTarget | null
  onToggleExpand: () => void
  onClick: () => void
  onAddChild: () => void
  onRename: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent, position: DropPosition) => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  const intl = useIntl()
  const rowRef = useRef<HTMLDivElement>(null)
  const hasChildren = node.childCount > 0
  const isDragging = draggedId === node.id
  const isDropInside = dropTarget?.nodeId === node.id && dropTarget.position === 'inside'
  const isDropBefore = dropTarget?.nodeId === node.id && dropTarget.position === 'before'
  const isDropAfter = dropTarget?.nodeId === node.id && dropTarget.position === 'after'

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!rowRef.current) return

    const rect = rowRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    const height = rect.height

    if (y < height * 0.25) {
      onDragOver(e, 'before')
    } else if (y > height * 0.75) {
      onDragOver(e, 'after')
    } else {
      onDragOver(e, 'inside')
    }
  }, [onDragOver])

  const row = (
    <div
      ref={rowRef}
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={handleDragOver}
      onDrop={e => {
        e.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative flex items-center gap-1 w-full rounded-md px-1.5 py-1.5 text-xs transition-colors cursor-pointer',
        isCurrent
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'opacity-40',
        isDropInside && 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20'
      )}
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={onClick}
    >
      {/* Drop indicator lines */}
      {isDropBefore && (
        <div className='absolute left-0 right-0 top-0 h-0.5 bg-blue-500' style={{ marginLeft: depth * 16 + 8 }} />
      )}
      {isDropAfter && (
        <div className='absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500' style={{ marginLeft: depth * 16 + 8 }} />
      )}

      {/* Expand/collapse */}
      {hasChildren ? (
        <button
          type='button'
          className='shrink-0 p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors'
          onClick={e => {
            e.stopPropagation()
            onToggleExpand()
          }}
        >
          {node.isLoading ? (
            <Loader2 size={12} className='animate-spin' />
          ) : (
            <ChevronRight
              size={12}
              className={cn('transition-transform', isExpanded && 'rotate-90')}
            />
          )}
        </button>
      ) : (
        <span className='w-[16px] shrink-0' />
      )}

      {/* Icon */}
      <FileText size={13} className='shrink-0' />

      {/* Label */}
      <span className='truncate flex-1'>
        {node.emoji ? `${node.emoji} ` : ''}
        {node.title || 'Untitled'}
      </span>

      {/* Badge: child count when collapsed */}
      {hasChildren && !isExpanded && (
        <span className='shrink-0 text-[10px] text-muted-foreground bg-muted rounded-full px-1.5'>
          {node.childCount}
        </span>
      )}

      {/* Add child button */}
      <button
        type='button'
        className='shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all'
        onClick={e => {
          e.stopPropagation()
          onAddChild()
        }}
      >
        <Plus size={12} />
      </button>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className='w-40'>
        <ContextMenuItem onClick={onAddChild}>
          <Plus size={14} className='mr-2' />
          {intl.formatMessage({ id: 'documentToc.addSubPage', defaultMessage: 'Add sub-page' })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename}>
          <Pencil size={14} className='mr-2' />
          {intl.formatMessage({ id: 'documentToc.rename', defaultMessage: 'Rename' })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className='text-destructive focus:text-destructive'>
          <Trash2 size={14} className='mr-2' />
          {intl.formatMessage({ id: 'documentToc.delete', defaultMessage: 'Delete' })}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ─── Recursive Tree Node ────────────────────────────────────

function TreeNodeGroup({
  nodes,
  depth,
  expandedIds,
  currentDocId,
  draggedId,
  dropTarget,
  onNavigate,
  onExpandNode,
  onAddChild,
  onRenameDoc,
  onDeleteDoc,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  nodes: TreeNode[]
  depth: number
  expandedIds: Set<string>
  currentDocId: string | null
  draggedId: string | null
  dropTarget: DropTarget | null
  onNavigate: (id: string) => void
  onExpandNode: (id: string) => void
  onAddChild: (parentId: string | null) => void
  onRenameDoc: (doc: { id: string; title: string }) => void
  onDeleteDoc: (doc: { id: string; title: string }) => void
  onDragStart: (id: string) => void
  onDragOver: (nodeId: string, position: DropPosition) => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  return (
    <div className={cn(depth > 0 && 'ml-3 border-l border-border pl-0.5')}>
      {nodes.map(node => {
        const isExpanded = expandedIds.has(node.id)
        return (
          <div key={node.id}>
            <TreeItemRow
              node={node}
              depth={depth}
              isExpanded={isExpanded}
              isCurrent={node.id === currentDocId}
              draggedId={draggedId}
              dropTarget={dropTarget}
              onToggleExpand={() => onExpandNode(node.id)}
              onClick={() => onNavigate(node.id)}
              onAddChild={() => onAddChild(node.id)}
              onRename={() => onRenameDoc(node)}
              onDelete={() => onDeleteDoc(node)}
              onDragStart={() => onDragStart(node.id)}
              onDragOver={(_, pos) => onDragOver(node.id, pos)}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
            />
            {isExpanded && node.children && node.children.length > 0 && (
              <TreeNodeGroup
                nodes={node.children}
                depth={depth + 1}
                expandedIds={expandedIds}
                currentDocId={currentDocId}
                draggedId={draggedId}
                dropTarget={dropTarget}
                onNavigate={onNavigate}
                onExpandNode={onExpandNode}
                onAddChild={onAddChild}
                onRenameDoc={onRenameDoc}
                onDeleteDoc={onDeleteDoc}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDrop={onDrop}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────

export function GlobalDocTree({
  roots,
  expandedIds,
  currentDocId,
  onNavigate,
  onExpandNode,
  onAddChild,
  onRenameDoc,
  onDeleteDoc,
  onMoveNode,
}: GlobalDocTreeProps) {
  const intl = useIntl()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDrop = useCallback(() => {
    if (!draggedId || !dropTarget || draggedId === dropTarget.nodeId) {
      setDraggedId(null)
      setDropTarget(null)
      return
    }

    // Find the target node to determine new parentId and sortOrder
    const findInRoots = (nodes: TreeNode[], id: string): { node: TreeNode; siblings: TreeNode[]; parent: TreeNode | null } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]!.id === id) return { node: nodes[i]!, siblings: nodes, parent: null }
        if (nodes[i]!.children) {
          const found = findInChildren(nodes[i]!.children!, nodes[i]!, id)
          if (found) return found
        }
      }
      return null
    }

    const findInChildren = (nodes: TreeNode[], parent: TreeNode, id: string): { node: TreeNode; siblings: TreeNode[]; parent: TreeNode } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]!.id === id) return { node: nodes[i]!, siblings: nodes, parent }
        if (nodes[i]!.children) {
          const found = findInChildren(nodes[i]!.children!, nodes[i]!, id)
          if (found) return found
        }
      }
      return null
    }

    const target = findInRoots(roots, dropTarget.nodeId)
    if (!target) {
      setDraggedId(null)
      setDropTarget(null)
      return
    }

    let newParentId: string | null
    let sortOrder: number

    if (dropTarget.position === 'inside') {
      // Drop inside: become child of target
      newParentId = dropTarget.nodeId
      sortOrder = (target.node.children?.length ?? 0)
    } else {
      // Drop before/after: become sibling
      newParentId = target.parent?.id ?? null
      const targetIdx = target.siblings.findIndex(s => s.id === dropTarget.nodeId)
      if (dropTarget.position === 'before') {
        sortOrder = targetIdx > 0 ? (target.siblings[targetIdx - 1]!.sortOrder + target.node.sortOrder) / 2 : target.node.sortOrder - 1
      } else {
        sortOrder = targetIdx < target.siblings.length - 1 ? (target.node.sortOrder + target.siblings[targetIdx + 1]!.sortOrder) / 2 : target.node.sortOrder + 1
      }
    }

    onMoveNode(draggedId, newParentId, sortOrder)

    // Background: call move API
    fetch(`${API.documents.move(draggedId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: newParentId, sortOrder }),
    })

    setDraggedId(null)
    setDropTarget(null)
  }, [draggedId, dropTarget, roots, onMoveNode])

  return (
    <div className='w-56 shrink-0 border-r overflow-y-auto py-3 px-2 text-xs'>
      <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1.5'>
        {intl.formatMessage({ id: 'documentEditor.pages', defaultMessage: 'Pages' })}
      </div>

      {roots.length === 0 ? (
        <div className='px-2 py-4 text-center text-muted-foreground'>
          {intl.formatMessage({ id: 'documentTree.empty', defaultMessage: 'No documents yet' })}
        </div>
      ) : (
        <TreeNodeGroup
          nodes={roots}
          depth={0}
          expandedIds={expandedIds}
          currentDocId={currentDocId}
          draggedId={draggedId}
          dropTarget={dropTarget}
          onNavigate={onNavigate}
          onExpandNode={onExpandNode}
          onAddChild={onAddChild}
          onRenameDoc={onRenameDoc}
          onDeleteDoc={onDeleteDoc}
          onDragStart={setDraggedId}
          onDragOver={(nodeId, position) => setDropTarget({ nodeId, position })}
          onDragEnd={() => {
            setDraggedId(null)
            setDropTarget(null)
          }}
          onDrop={handleDrop}
        />
      )}

      {/* Add root document button */}
      <button
        type='button'
        className='flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 mt-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
        onClick={() => onAddChild(null)}
      >
        <Plus size={13} />
        <span>{intl.formatMessage({ id: 'documentTree.newDoc', defaultMessage: 'New document' })}</span>
      </button>
    </div>
  )
}
```

Note: `API.documents.move` is already defined in `constants.ts`.

- [ ] **Step 2: Add missing i18n keys**

Add to `lib/i18n/zh.json`:

```json
"documentTree.empty": "暂无文档",
"documentTree.newDoc": "新建文档",
```

Add to `lib/i18n/en.json`:

```json
"documentTree.empty": "No documents yet",
"documentTree.newDoc": "New document",
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx" lib/i18n/zh.json lib/i18n/en.json
git commit -m "feat: add GlobalDocTree component with Feishu-style tree [LUM-15]"
```

---

### Task 5: Integrate into WorkspaceApp

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`

This is the integration step: wire `useDocumentTree` and `GlobalDocTree` into WorkspaceApp, remove tree logic from DocumentEditorPage.

- [ ] **Step 1: Add useDocumentTree and GlobalDocTree to WorkspaceApp**

In `WorkspaceApp.tsx`, add imports:

```typescript
import { useDocumentTree } from './hooks/useDocumentTree'
import { GlobalDocTree } from './components/document/GlobalDocTree'
```

Inside the `DashboardApp` component (after existing hooks around line 192), add:

```typescript
const docTree = useDocumentTree(selectedDocumentId)
```

- [ ] **Step 2: Add rename/delete dialog state to WorkspaceApp**

Move the rename and delete dialog state from DocumentEditorPage to WorkspaceApp (since tree actions now happen at the WorkspaceApp level). Add state variables inside `DashboardApp`:

```typescript
// Tree rename/delete dialog state
const [treeRenameDoc, setTreeRenameDoc] = useState<{
  id: string
  title: string
} | null>(null)
const [treeRenameValue, setTreeRenameValue] = useState('')
const [treeDeleteDoc, setTreeDeleteDoc] = useState<{
  id: string
  title: string
} | null>(null)
```

Add the Dialog and AlertDialog imports if not already present:

```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
```

- [ ] **Step 3: Render GlobalDocTree in the document pages**

Find the `case 'documents':` and `case 'document-editor':` render blocks. Wrap both in a flex layout that includes the GlobalDocTree on the left:

```typescript
case 'documents':
  return (
    <div className='flex-1 flex overflow-hidden'>
      <GlobalDocTree
        roots={docTree.roots}
        expandedIds={docTree.expandedIds}
        currentDocId={null}
        onNavigate={id => {
          setSelectedDocumentId(id)
          setCurrentPage('document-editor')
          window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents/${id}`)
        }}
        onExpandNode={docTree.expandNode}
        onAddChild={parentId => {
          // Same optimistic create logic as existing onCreateChildDocument
          const tempId = `temp-${crypto.randomUUID()}`
          const node: TreeNode = {
            id: tempId, title: '', emoji: null,
            parentId, sortOrder: Date.now(), childCount: 0,
          }
          docTree.addNode(parentId, node)
          // Navigate to new doc
          setSelectedDocumentId(tempId)
          setCurrentPage('document-editor')
          window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents/${tempId}`)
          // Write optimistic cache for DocumentEditorPage
          writeCache(CACHE_KEY.documentDetail(tempId), {
            id: tempId, title: '', emoji: null, parentId,
            content: null, children: [], shares: [], ancestors: [],
            visibility: 'PRIVATE', sortOrder: 0, createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(), projectId: null, project: null,
            workspaceId: '', createdById: '',
            createdBy: { id: '', name: '', imageUrl: null },
          })
          // Background sync
          fetch(API.documents.list, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentId }),
          })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (!data) return
              const realId = data.document.id as string
              docTree.replaceNodeId(tempId, realId)
              writeCache(CACHE_KEY.documentDetail(realId), { ...data.document, ancestors: data.ancestors ?? [] })
              try { localStorage.removeItem(CACHE_KEY.documentDetail(tempId)) } catch { /* */ }
              setSelectedDocumentId(prev => {
                if (prev === tempId) return realId
                return prev
              })
              if (window.location.pathname.includes(tempId)) {
                window.history.replaceState(null, '', `/workspace/${workspaceUrl}/documents/${realId}`)
              }
            })
        }}
        onRenameDoc={doc => { setTreeRenameValue(doc.title); setTreeRenameDoc(doc) }}
        onDeleteDoc={doc => setTreeDeleteDoc(doc)}
        onMoveNode={docTree.moveNode}
      />
      <DocumentsPage ... /> {/* existing props */}
    </div>
  )
```

Apply the same `GlobalDocTree` rendering for `case 'document-editor':`, but with `currentDocId={selectedDocumentId}`.

- [ ] **Step 4: Add rename/delete dialogs to WorkspaceApp render**

Add the Dialog and AlertDialog JSX at the end of the WorkspaceApp return, before the closing fragment/div. Use the same pattern as currently exists in DocumentEditorPage, but using `treeRenameDoc`/`treeDeleteDoc` state and calling `docTree.renameNode` / `docTree.removeNode` for optimistic updates.

On rename submit:

```typescript
docTree.renameNode(renamedId, treeRenameValue)
fetch(API.documents.byId(renamedId), {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: treeRenameValue }),
})
```

On delete confirm:

```typescript
docTree.removeNode(deletedId)
if (selectedDocumentId === deletedId) {
  setCurrentPage('documents')
  window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents`)
}
fetch(API.documents.byId(deletedId), { method: 'DELETE' })
```

- [ ] **Step 5: Simplify DocumentEditorPage**

Remove from DocumentEditorPage:

- `ancestors` state and all ancestor-related logic
- `renameDoc`, `renameValue`, `deleteDoc` state
- The `DocumentTOC` import and rendering
- The rename Dialog and delete AlertDialog JSX
- The `onRenameChild`, `onDeleteChild`, `onReorderChildren` props from DocumentTOC

Keep:

- Document detail fetching (for content, title, emoji)
- Save/autosave logic
- Editor rendering
- Breadcrumb (can derive from tree data or keep fetching from API)

The component should just render the editor area without the left sidebar:

```typescript
return (
  <div className='flex-1 overflow-y-auto'>
    {loading ? (
      <div className='flex-1 flex items-center justify-center h-full'>
        <div className='animate-pulse text-muted-foreground text-sm'>Loading...</div>
      </div>
    ) : doc ? (
      <div className='max-w-3xl mx-auto px-8 py-6'>
        <DocumentBreadcrumb ... />
        {/* Emoji + Title */}
        {/* Metadata */}
        <DescriptionEditor ... />
      </div>
    ) : (
      <div className='flex-1 flex items-center justify-center'>
        <div className='text-muted-foreground text-sm'>Document not found</div>
      </div>
    )}
  </div>
)
```

Remove the `onCreateChildDocument` prop — creation is now handled by GlobalDocTree callbacks in WorkspaceApp.

- [ ] **Step 6: Delete DocumentTOC.tsx**

```bash
git rm "app/workspace/[workspaceUrl]/components/document/DocumentTOC.tsx"
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`
Fix any type errors from the refactoring.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: integrate GlobalDocTree into WorkspaceApp, simplify DocumentEditorPage [LUM-15]"
```

---

### Task 6: Auto-expand on navigation and refresh on focus

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`
- Modify: `app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts`

- [ ] **Step 1: Auto-expand path when navigating to a document**

In WorkspaceApp, whenever `selectedDocumentId` changes (in `onNavigate` callbacks), call `docTree.expandPathTo(id)` after setting the document ID:

```typescript
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
  [workspaceUrl, docTree]
)
```

Use this `navigateToDocument` function in all places that currently do `setSelectedDocumentId` + `pushState` for document navigation.

- [ ] **Step 2: Refresh tree on window focus**

In `useDocumentTree.ts`, add a window focus listener:

```typescript
useEffect(() => {
  const handleFocus = () => {
    refresh()
  }
  window.addEventListener('focus', handleFocus)
  return () => window.removeEventListener('focus', handleFocus)
}, [refresh])
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/WorkspaceApp.tsx" "app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts"
git commit -m "feat: auto-expand tree path on navigation, refresh on focus [LUM-15]"
```

---

### Task 7: Final cleanup and verification

- [ ] **Step 1: Remove unused imports and types**

Check for any unused imports of `DocumentTOC`, `ApiDocumentAncestor` in files that no longer need them. Clean up.

- [ ] **Step 2: Full TypeScript check**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Manual smoke test**

Verify in browser:

1. Documents page shows global tree in left sidebar
2. Clicking a document navigates and highlights it in tree
3. Tree persists when switching between documents
4. Expand/collapse works, collapsed nodes show child count badge
5. Right-click context menu works (add sub-page, rename, delete)
6. Drag-and-drop reorder within same parent works
7. Drag-and-drop to different parent works
8. Creating new doc via `+` button adds to tree optimistically
9. Deleting a doc removes from tree optimistically
10. Tree state (expanded nodes) persists across page refresh

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: cleanup unused imports and finalize global tree [LUM-15]"
```
