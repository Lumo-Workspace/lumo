'use client'

import { useMemo, useState, useCallback, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { FileText, Plus, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { ApiDocument, ApiDocumentAncestor } from '../../types'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface TocHeading {
  id: string
  text: string
  level: number
}

interface DocumentTOCProps {
  editor: Editor | null
  ancestors: ApiDocumentAncestor[]
  currentDoc: { id: string; title: string; emoji: string | null }
  childDocs: ApiDocument[]
  onNavigate: (id: string | null) => void
  onAddChild: (parentId: string) => void
  onRenameDoc?: (doc: { id: string; title: string }) => void
  onDeleteDoc?: (doc: { id: string; title: string }) => void
  onReorderChildren?: (orderedIds: string[]) => void
}

// ─── Doc Tree Item ───────────────────────────────────────────────────────────

function DocTreeItem({
  id,
  title,
  emoji,
  isActive,
  isCurrent,
  depth,
  hasChildren,
  defaultExpanded,
  onClick,
  draggable: isDraggable,
  draggedId,
  dropTargetId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onAddChild,
  onRename,
  onDelete,
  children,
}: {
  id: string
  title: string
  emoji?: string | null
  isActive: boolean
  isCurrent?: boolean
  depth: number
  hasChildren: boolean
  defaultExpanded: boolean
  onClick: () => void
  draggable?: boolean
  draggedId?: string | null
  dropTargetId?: string | null
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
  onDragEnd?: () => void
  onAddChild?: (() => void) | undefined
  onRename?: (() => void) | undefined
  onDelete?: (() => void) | undefined
  children?: React.ReactNode
}) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isDragging = draggedId === id
  const isDropTarget = dropTargetId === id && draggedId !== id

  const row = (
    <div
      draggable={isDraggable}
      onDragStart={
        isDraggable
          ? e => {
              e.dataTransfer.effectAllowed = 'move'
              onDragStart?.()
            }
          : undefined
      }
      onDragOver={
        isDraggable
          ? e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              onDragOver?.()
            }
          : undefined
      }
      onDrop={
        isDraggable
          ? e => {
              e.preventDefault()
              onDrop?.()
            }
          : undefined
      }
      onDragEnd={isDraggable ? onDragEnd : undefined}
      className={cn(
        'group flex items-center gap-1 w-full rounded-md px-1.5 py-1 text-xs transition-colors cursor-pointer',
        isCurrent
          ? 'bg-accent text-accent-foreground font-medium'
          : isActive
            ? 'text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'opacity-40',
        isDropTarget && 'ring-1 ring-blue-400 bg-blue-50 dark:bg-blue-900/20'
      )}
      style={{ paddingLeft: depth * 12 + 6 }}
      onClick={onClick}
    >
      {/* Expand/collapse */}
      {hasChildren ? (
        <button
          type='button'
          className='shrink-0 p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors'
          onClick={e => {
            e.stopPropagation()
            setExpanded(o => !o)
          }}
        >
          <ChevronRight
            size={12}
            className={cn('transition-transform', expanded && 'rotate-90')}
          />
        </button>
      ) : (
        <span className='w-[16px] shrink-0' />
      )}

      {/* Icon */}
      <FileText size={13} className='shrink-0' />

      {/* Label */}
      <span className='truncate flex-1'>
        {emoji ? `${emoji} ` : ''}
        {title || 'Untitled'}
      </span>

      {/* Add child button */}
      {onAddChild && (
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
      )}
    </div>
  )

  const hasContextMenu = onAddChild || onRename || onDelete
  const wrappedRow = hasContextMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className='w-40'>
        {onAddChild && (
          <ContextMenuItem onClick={onAddChild}>
            <Plus size={14} className='mr-2' />
            {intl.formatMessage({
              id: 'documentToc.addSubPage',
              defaultMessage: 'Add sub-page',
            })}
          </ContextMenuItem>
        )}
        {onAddChild && (onRename || onDelete) && <ContextMenuSeparator />}
        {onRename && (
          <ContextMenuItem onClick={onRename}>
            <Pencil size={14} className='mr-2' />
            {intl.formatMessage({
              id: 'documentToc.rename',
              defaultMessage: 'Rename',
            })}
          </ContextMenuItem>
        )}
        {onRename && onDelete && <ContextMenuSeparator />}
        {onDelete && (
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
        )}
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    row
  )

  return (
    <div>
      {wrappedRow}
      {hasChildren && expanded && children}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DocumentTOC({
  editor,
  ancestors,
  currentDoc,
  childDocs,
  onNavigate,
  onAddChild,
  onRenameDoc,
  onDeleteDoc,
  onReorderChildren,
}: DocumentTOCProps) {
  const intl = useIntl()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [localOrder, setLocalOrder] = useState<ApiDocument[]>(childDocs)

  // Sync local order with prop
  useEffect(() => {
    setLocalOrder(childDocs)
  }, [childDocs])

  const headings = useMemo<TocHeading[]>(() => {
    if (!editor) return []
    const result: TocHeading[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const id = `heading-${pos}`
        result.push({
          id,
          text: node.textContent,
          level: node.attrs.level as number,
        })
      }
    })
    return result
  }, [editor, editor?.state.doc])

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!draggedId || draggedId === targetId) return
      setLocalOrder(prev => {
        const items = [...prev]
        const fromIdx = items.findIndex(d => d.id === draggedId)
        const toIdx = items.findIndex(d => d.id === targetId)
        if (fromIdx === -1 || toIdx === -1) return prev
        const [moved] = items.splice(fromIdx, 1)
        items.splice(toIdx, 0, moved!)
        onReorderChildren?.(items.map(d => d.id))
        return items
      })
      setDraggedId(null)
      setDropTargetId(null)
    },
    [draggedId, onReorderChildren]
  )

  // Build the tree structure.
  // For each ancestor, we show the ancestor AND its siblings (children of its parent).
  // The current doc's children are shown expanded under it.

  // Current document's children
  const currentChildren = (
    <div className='space-y-0.5'>
      {localOrder.map(child => (
        <DocTreeItem
          key={child.id}
          id={child.id}
          title={child.title}
          emoji={child.emoji}
          isActive={false}
          depth={ancestors.length + 1}
          hasChildren={(child._count?.children ?? 0) > 0}
          defaultExpanded={false}
          onClick={() => onNavigate(child.id)}
          draggable
          draggedId={draggedId}
          dropTargetId={dropTargetId}
          onDragStart={() => setDraggedId(child.id)}
          onDragOver={() => setDropTargetId(child.id)}
          onDrop={() => handleDrop(child.id)}
          onDragEnd={() => {
            setDraggedId(null)
            setDropTargetId(null)
          }}
          onAddChild={() => onAddChild(child.id)}
          onRename={onRenameDoc ? () => onRenameDoc(child) : undefined}
          onDelete={onDeleteDoc ? () => onDeleteDoc(child) : undefined}
        />
      ))}
    </div>
  )

  // Current document node (always expanded, highlighted)
  const currentDocNode = (
    <DocTreeItem
      id={currentDoc.id}
      title={currentDoc.title}
      emoji={currentDoc.emoji}
      isActive
      isCurrent
      depth={ancestors.length}
      hasChildren={localOrder.length > 0}
      defaultExpanded
      draggable={ancestors.length > 0}
      draggedId={draggedId}
      dropTargetId={dropTargetId}
      onDragStart={() => setDraggedId(currentDoc.id)}
      onDragOver={() => setDropTargetId(currentDoc.id)}
      onDrop={() => handleDrop(currentDoc.id)}
      onDragEnd={() => {
        setDraggedId(null)
        setDropTargetId(null)
      }}
      onAddChild={() => onAddChild(currentDoc.id)}
      onRename={onRenameDoc ? () => onRenameDoc(currentDoc) : undefined}
      onDelete={onDeleteDoc ? () => onDeleteDoc(currentDoc) : undefined}
      onClick={() => {
        /* already on this doc */
      }}
    >
      {currentChildren}
    </DocTreeItem>
  )

  // Build ancestor tree from innermost to outermost
  // Each ancestor shows ALL its children (siblings of the next level),
  // with the "active path" child expanded to show the next level
  let treeContent: React.ReactNode = currentDocNode

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i]!
    const siblingChildren = ancestor.children ?? []
    // The next item in the path is either ancestors[i+1] or currentDoc
    const activeChildId =
      i < ancestors.length - 1 ? ancestors[i + 1]!.id : currentDoc.id
    const inner = treeContent

    const isTopmost = i === 0
    treeContent = (
      <DocTreeItem
        key={ancestor.id}
        id={ancestor.id}
        title={ancestor.title}
        emoji={ancestor.emoji}
        isActive
        depth={i}
        hasChildren={siblingChildren.length > 0}
        defaultExpanded
        draggable={!isTopmost}
        draggedId={draggedId}
        dropTargetId={dropTargetId}
        onDragStart={() => setDraggedId(ancestor.id)}
        onDragOver={() => setDropTargetId(ancestor.id)}
        onDrop={() => handleDrop(ancestor.id)}
        onDragEnd={() => {
          setDraggedId(null)
          setDropTargetId(null)
        }}
        onAddChild={() => onAddChild(ancestor.id)}
        onRename={onRenameDoc ? () => onRenameDoc(ancestor) : undefined}
        onDelete={onDeleteDoc ? () => onDeleteDoc(ancestor) : undefined}
        onClick={() => onNavigate(ancestor.id)}
      >
        <div className='space-y-0.5'>
          {siblingChildren.map(sibling =>
            sibling.id === activeChildId ? (
              // This is the active path child — render the nested tree
              <div key={sibling.id}>{inner}</div>
            ) : (
              // Sibling — just show as a simple item
              <DocTreeItem
                key={sibling.id}
                id={sibling.id}
                title={sibling.title}
                emoji={sibling.emoji}
                isActive={false}
                depth={i + 1}
                hasChildren={(sibling._count?.children ?? 0) > 0}
                defaultExpanded={false}
                draggable
                draggedId={draggedId}
                dropTargetId={dropTargetId}
                onDragStart={() => setDraggedId(sibling.id)}
                onDragOver={() => setDropTargetId(sibling.id)}
                onDrop={() => handleDrop(sibling.id)}
                onDragEnd={() => {
                  setDraggedId(null)
                  setDropTargetId(null)
                }}
                onAddChild={() => onAddChild(sibling.id)}
                onRename={onRenameDoc ? () => onRenameDoc(sibling) : undefined}
                onDelete={onDeleteDoc ? () => onDeleteDoc(sibling) : undefined}
                onClick={() => onNavigate(sibling.id)}
              />
            )
          )}
        </div>
      </DocTreeItem>
    )
  }

  return (
    <div className='w-56 shrink-0 border-r overflow-y-auto py-3 px-2 text-xs'>
      {/* Document tree structure */}
      <div className='mb-3'>
        <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1.5'>
          {intl.formatMessage({
            id: 'documentEditor.pages',
            defaultMessage: 'Pages',
          })}
        </div>
        <div className='space-y-0.5'>{treeContent}</div>
      </div>

      {/* Separator if headings exist */}
      {headings.length > 0 && <div className='h-px bg-border mx-2 mb-3' />}

      {/* TOC headings */}
      {headings.length > 0 && (
        <div>
          <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1.5'>
            {intl.formatMessage({
              id: 'documentEditor.tocTitle',
              defaultMessage: 'On this page',
            })}
          </div>
          {headings.map(h => (
            <button
              key={h.id}
              type='button'
              className={cn(
                'block w-full text-left rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground truncate transition-colors',
                h.level === 1 && 'font-medium text-foreground',
                h.level === 2 && 'pl-5',
                h.level === 3 && 'pl-8',
                h.level === 4 && 'pl-11'
              )}
              onClick={() => {
                const el = document.getElementById(h.id)
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {h.text || 'Untitled'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
