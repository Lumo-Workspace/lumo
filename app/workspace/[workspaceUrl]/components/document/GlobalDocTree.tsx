'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import {
  FileText,
  Plus,
  ChevronRight,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react'
import type { TreeNode } from '../../types'
import { cn } from '@/lib/utils'
import { API } from '../../constants'
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
  onMoveNode: (
    nodeId: string,
    newParentId: string | null,
    sortOrder: number
  ) => void
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
  const isDropInside =
    dropTarget?.nodeId === node.id && dropTarget.position === 'inside'
  const isDropBefore =
    dropTarget?.nodeId === node.id && dropTarget.position === 'before'
  const isDropAfter =
    dropTarget?.nodeId === node.id && dropTarget.position === 'after'

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
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
    },
    [onDragOver]
  )

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
        <div
          className='absolute left-0 right-0 top-0 h-0.5 bg-blue-500'
          style={{ marginLeft: depth * 16 + 8 }}
        />
      )}
      {isDropAfter && (
        <div
          className='absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500'
          style={{ marginLeft: depth * 16 + 8 }}
        />
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
          {intl.formatMessage({
            id: 'documentToc.addSubPage',
            defaultMessage: 'Add sub-page',
          })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename}>
          <Pencil size={14} className='mr-2' />
          {intl.formatMessage({
            id: 'documentToc.rename',
            defaultMessage: 'Rename',
          })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onDelete}
          className='text-destructive focus:text-destructive'
        >
          <Trash2 size={14} className='mr-2' />
          {intl.formatMessage({
            id: 'documentToc.delete',
            defaultMessage: 'Delete',
          })}
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
    const findInRoots = (
      nodes: TreeNode[],
      id: string
    ): {
      node: TreeNode
      siblings: TreeNode[]
      parent: TreeNode | null
    } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]!.id === id)
          return { node: nodes[i]!, siblings: nodes, parent: null }
        if (nodes[i]!.children) {
          const found = findInChildren(nodes[i]!.children!, nodes[i]!, id)
          if (found) return found
        }
      }
      return null
    }

    const findInChildren = (
      nodes: TreeNode[],
      parent: TreeNode,
      id: string
    ): { node: TreeNode; siblings: TreeNode[]; parent: TreeNode } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]!.id === id)
          return { node: nodes[i]!, siblings: nodes, parent }
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
      sortOrder = target.node.children?.length ?? 0
    } else {
      // Drop before/after: become sibling
      newParentId = target.parent?.id ?? null
      const targetIdx = target.siblings.findIndex(
        s => s.id === dropTarget.nodeId
      )
      if (dropTarget.position === 'before') {
        sortOrder =
          targetIdx > 0
            ? (target.siblings[targetIdx - 1]!.sortOrder +
                target.node.sortOrder) /
              2
            : target.node.sortOrder - 1
      } else {
        sortOrder =
          targetIdx < target.siblings.length - 1
            ? (target.node.sortOrder +
                target.siblings[targetIdx + 1]!.sortOrder) /
              2
            : target.node.sortOrder + 1
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
        {intl.formatMessage({
          id: 'documentEditor.pages',
          defaultMessage: 'Pages',
        })}
      </div>

      {roots.length === 0 ? (
        <div className='px-2 py-4 text-center text-muted-foreground'>
          {intl.formatMessage({
            id: 'documentTree.empty',
            defaultMessage: 'No documents yet',
          })}
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
        <span>
          {intl.formatMessage({
            id: 'documentTree.newDoc',
            defaultMessage: 'New document',
          })}
        </span>
      </button>
    </div>
  )
}
