'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import {
  Plus,
  ChevronRight,
  Pencil,
  Trash2,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  House,
} from 'lucide-react'
import type { TreeNode } from '../../types'
import { cn } from '@/lib/utils'
import { documentsClient } from '@/lib/api-client'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  onCollapse: () => void
  onNavigateHome: () => void
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
      style={{ paddingLeft: `${depth * 4 + 8}px`, paddingRight: '6px' }}
      className={cn(
        'group relative flex items-center gap-1.5 w-full rounded-sm py-1.5 text-[13px] font-medium transition-colors cursor-pointer select-none',
        isCurrent
          ? 'bg-accent text-accent-foreground font-semibold'
          : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground',
        isDragging && 'opacity-40',
        isDropInside && 'ring-1 ring-blue-400 bg-blue-50 dark:bg-blue-900/20'
      )}
      onClick={onClick}
    >
      {/* Drop indicator lines */}
      {isDropBefore && (
        <div className='absolute left-2 right-2 top-0 h-0.5 bg-blue-500 rounded-full' />
      )}
      {isDropAfter && (
        <div className='absolute left-2 right-2 bottom-0 h-0.5 bg-blue-500 rounded-full' />
      )}

      {/* Emoji / expand toggle (Notion-style: emoji morphs into chevron on hover) */}
      {hasChildren ? (
        <button
          type='button'
          className='relative shrink-0 flex items-center justify-center w-6 h-6 rounded-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors'
          onClick={e => {
            e.stopPropagation()
            onToggleExpand()
          }}
        >
          {node.isLoading ? (
            <Loader2 size={12} className='animate-spin text-muted-foreground' />
          ) : (
            <>
              <span className='text-[13px] leading-none transition-opacity group-hover:opacity-0'>
                {node.emoji || '📄'}
              </span>
              <ChevronRight
                size={12}
                className={cn(
                  'absolute text-muted-foreground opacity-0 transition-all duration-fast group-hover:opacity-100',
                  isExpanded && 'rotate-90'
                )}
              />
            </>
          )}
        </button>
      ) : (
        <span className='shrink-0 flex items-center justify-center w-6 h-6 text-[13px] leading-none'>
          {node.emoji || '📄'}
        </span>
      )}

      {/* Label */}
      <span className='truncate flex-1'>
        {node.title ||
          intl.formatMessage({
            id: 'documents.untitled',
            defaultMessage: 'Untitled',
          })}
      </span>

      {/* Hover actions — `+` first, `…` second (Notion-style) */}
      <div className='shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
        {/* Add child */}
        <button
          type='button'
          className='flex items-center justify-center w-6 h-6 rounded-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors'
          onClick={e => {
            e.stopPropagation()
            onAddChild()
          }}
        >
          <Plus size={13} className='text-muted-foreground' />
        </button>

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='flex items-center justify-center w-6 h-6 rounded-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors'
              onClick={e => e.stopPropagation()}
            >
              <MoreHorizontal size={13} className='text-muted-foreground' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-40'>
            {/*
             * stopPropagation on every menu item is required because Radix's
             * Portal-rendered menus still bubble React synthetic events up the
             * React component tree (not the DOM tree). Without it, clicking a
             * menu item also fires the row's onClick → navigates to the doc the
             * user was just trying to rename/delete.
             */}
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation()
                onAddChild()
              }}
            >
              <Plus size={14} className='mr-2' />
              {intl.formatMessage({
                id: 'documentToc.addSubPage',
                defaultMessage: 'Add sub-page',
              })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation()
                onRename()
              }}
            >
              <Pencil size={14} className='mr-2' />
              {intl.formatMessage({
                id: 'documentToc.rename',
                defaultMessage: 'Rename',
              })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation()
                onDelete()
              }}
              className='text-danger-text focus:text-danger-text'
            >
              <Trash2 size={14} className='mr-2' />
              {intl.formatMessage({
                id: 'documentToc.delete',
                defaultMessage: 'Delete',
              })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className='w-40'>
        {/* See note on DropdownMenuItem above — same React-portal bubbling. */}
        <ContextMenuItem
          onClick={e => {
            e.stopPropagation()
            onAddChild()
          }}
        >
          <Plus size={14} className='mr-2' />
          {intl.formatMessage({
            id: 'documentToc.addSubPage',
            defaultMessage: 'Add sub-page',
          })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={e => {
            e.stopPropagation()
            onRename()
          }}
        >
          <Pencil size={14} className='mr-2' />
          {intl.formatMessage({
            id: 'documentToc.rename',
            defaultMessage: 'Rename',
          })}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
          className='text-danger-text focus:text-danger-text'
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
    <div>
      {nodes.map(node => {
        const isExpanded = expandedIds.has(node.id)
        return (
          <div key={node.id}>
            <TreeItemRow
              node={node}
              depth={depth}
              isExpanded={isExpanded}
              // `currentDocId` holds the URL identifier (slug for real docs,
              // temp-uuid while a node is still optimistic), so compare
              // against the same field. Falls back to node.id for the brief
              // window between optimistic create and server round-trip.
              isCurrent={(node.slug ?? node.id) === currentDocId}
              draggedId={draggedId}
              dropTarget={dropTarget}
              onToggleExpand={() => onExpandNode(node.id)}
              onClick={() => onNavigate(node.slug ?? node.id)}
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
  onCollapse,
  onNavigateHome,
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
      newParentId = dropTarget.nodeId
      sortOrder = target.node.children?.length ?? 0
    } else {
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

    documentsClient
      .move(draggedId, { parentId: newParentId, sortOrder })
      .catch(() => {
        /* best-effort */
      })

    setDraggedId(null)
    setDropTarget(null)
  }, [draggedId, dropTarget, roots, onMoveNode])

  return (
    <div className='w-56 shrink-0 border-r flex flex-col overflow-hidden'>
      {/* Sidebar header with collapse toggle — pt-6 matches main content top bar */}
      <div className='flex items-center px-2 pt-6 pb-2'>
        <button
          type='button'
          onClick={onCollapse}
          title={intl.formatMessage({
            id: 'documentTree.collapse',
            defaultMessage: 'Collapse sidebar (⌘\\)',
          })}
          className='flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0'
        >
          <PanelLeftClose className='size-4' />
        </button>
        <button
          type='button'
          onClick={onNavigateHome}
          title={intl.formatMessage({
            id: 'documentTree.home',
            defaultMessage: 'All documents',
          })}
          className='flex items-center justify-center size-8 ml-0.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0'
        >
          <House className='size-4' />
        </button>
        <span className='truncate text-sm font-medium text-foreground'>
          {intl.formatMessage({
            id: 'documentTree.allDocs',
            defaultMessage: 'Lumo 文档',
          })}
        </span>
      </div>

      <div className='flex-1 overflow-y-auto pb-1 px-1.5'>
        {roots.length > 0 && (
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
            onDragOver={(nodeId, position) =>
              setDropTarget({ nodeId, position })
            }
            onDragEnd={() => {
              setDraggedId(null)
              setDropTarget(null)
            }}
            onDrop={handleDrop}
          />
        )}

        {/* Add root document */}
        <button
          type='button'
          className='flex items-center gap-1.5 w-full rounded-sm py-1.5 mt-0.5 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors'
          style={{ paddingLeft: '8px', paddingRight: '6px' }}
          onClick={() => onAddChild(null)}
        >
          <span className='shrink-0 flex items-center justify-center w-6 h-6'>
            <Plus size={14} />
          </span>
          <span className='truncate'>
            {intl.formatMessage({
              id: 'documentTree.newDoc',
              defaultMessage: 'New document',
            })}
          </span>
        </button>
      </div>
    </div>
  )
}

// ─── Collapsed Rail ──────────────────────────────────────────
// Slim left column shown in place of the full tree when the doc tree is
// collapsed. Mirrors the expanded tree's `pt-6` and size-8 button so the
// expand control sits at the exact same x/y as the collapse control —
// toggling the sidebar feels like the button stays in place.

export function CollapsedDocTreeRail({ onExpand }: { onExpand: () => void }) {
  const intl = useIntl()
  return (
    <aside className='w-12 shrink-0 flex flex-col items-center pt-6'>
      <button
        type='button'
        onClick={onExpand}
        title={intl.formatMessage({
          id: 'documentTree.expand',
          defaultMessage: 'Expand sidebar (⌘\\)',
        })}
        className='flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
      >
        <PanelLeftOpen className='size-4' />
      </button>
    </aside>
  )
}
