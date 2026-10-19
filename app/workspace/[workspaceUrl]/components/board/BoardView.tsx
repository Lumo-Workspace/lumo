'use client'

import { cloneElement, isValidElement, useRef, type ReactNode } from 'react'
import {
  DndContext,
  closestCorners,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  useDroppable,
  SensorDescriptor,
  SensorOptions,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus } from 'lucide-react'
import { useIntl } from 'react-intl'
import { StatusIcon } from '../StatusIcon'
import {
  boardStatuses,
  statusLabel,
  type StatusLabelIntl,
} from '../../utils/taskStatus'
import { Button } from '@/components/ui/button'
import {
  shouldVirtualize,
  BOARD_COLUMN_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'
import { Badge } from '@/components/ui/badge'

// ─── Droppable column wrapper ─────────────────────────────────────────────────

function DroppableColumn({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className='board-col-scroll flex-1 overflow-y-auto space-y-3 min-h-[100px] pb-2'
    >
      {children}
    </div>
  )
}

// ─── Virtualized column body ─────────────────────────────────────────────────
// One virtualizer per column. Rendered ONLY when the column is over threshold.
// Outer wrapper handles translateY positioning; the inner card keeps its own
// dnd-kit sortable transform (the two MUST stay on separate elements).
function VirtualColumnBody<T extends { id: string }>({
  columnId,
  items,
  renderCard,
  footer,
}: {
  columnId: string
  items: T[]
  renderCard: (task: T, isOverlay: boolean) => React.ReactNode
  footer?: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { setNodeRef } = useDroppable({ id: columnId })
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96, // card height + space-y-3 gap; refined by measureElement
    overscan: 6,
  })

  const setRefs = (el: HTMLDivElement | null) => {
    scrollRef.current = el
    setNodeRef(el)
  }

  return (
    <div
      ref={setRefs}
      className='board-col-scroll flex-1 overflow-y-auto min-h-[100px] pb-2'
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vi => {
          const task = items[vi.index]
          if (!task) return null
          return (
            <div
              key={task.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 12, // matches space-y-3 gap
              }}
            >
              {renderCard(task, false)}
            </div>
          )
        })}
      </div>
      {footer}
    </div>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

export interface BoardColumn {
  /** Unique id used as the droppable id and the SortableContext id. */
  id: string
  /** Header label shown to the user. */
  label: string
  /** Optional decorative icon rendered next to the label. */
  icon?: ReactNode
}

function statusColumn(intl: StatusLabelIntl, status: string): BoardColumn {
  return {
    id: status,
    label: statusLabel(intl, status),
    icon: <StatusIcon status={status} size={13} />,
  }
}

// ─── BoardView ────────────────────────────────────────────────────────────────

interface BoardViewProps<T extends { id: string; viewOrder: number | null }> {
  tasks: T[]
  sensors: SensorDescriptor<SensorOptions>[]
  activeId: string | null
  onDragStart: (event: { active: { id: string | number } }) => void
  onDragOver: (event: DragOverEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  /** Render a task card. Pass isOverlay=true when rendering inside DragOverlay. */
  renderCard: (task: T, isOverlay: boolean) => React.ReactNode
  /** If provided, shows "Add task" button at the bottom of each column. */
  onAddTask?: (columnId: string) => void
  /** When set, drag reordering within a column is blocked and a hint is shown. */
  orderingLabel?: string | undefined
  /**
   * Custom column list. Defaults to the four task-status columns, plus a
   * leading Backlog column only while some task is in BACKLOG (LUM-1057).
   */
  columns?: BoardColumn[]
  /** Map a task to the id of the column it belongs in. Defaults to `t.status`. */
  getColumnId?: (task: T) => string
}

export function BoardView<T extends { id: string; viewOrder: number | null }>({
  tasks,
  sensors,
  activeId,
  onDragStart,
  onDragOver,
  onDragEnd,
  renderCard,
  onAddTask,
  orderingLabel,
  columns,
  getColumnId = (t: T) => String((t as unknown as { status: string }).status),
}: BoardViewProps<T>) {
  const intl = useIntl()
  // Drag is always live — even with a non-manual sort applied, users expect
  // to be able to drag a card between columns to change its status. When
  // `orderingLabel` is set we still honour the caller's sort for display
  // (no manual viewOrder sort), and we show a small hint at the top so
  // users know same-column reorder persists but will be visually
  // overridden until they switch back to Manual.
  const activeTask = tasks.find(t => t.id === activeId) ?? null
  const shownColumns =
    columns ??
    boardStatuses(tasks.map(t => ({ status: getColumnId(t) }))).map(s =>
      statusColumn(intl, s)
    )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className='border-t border-border p-8 flex gap-3 flex-1 bg-muted/50 overflow-x-auto'>
        {shownColumns.map(column => {
          const filtered = tasks.filter(t => getColumnId(t) === column.id)
          const col = orderingLabel
            ? filtered
            : filtered.sort((a, b) => (a.viewOrder ?? 0) - (b.viewOrder ?? 0))
          return (
            <div
              key={column.id}
              className='w-80 min-w-[320px] flex flex-col overflow-hidden'
            >
              {/* Column header */}
              <div className='flex items-center justify-between px-1 mb-3 shrink-0'>
                <div className='flex items-center gap-2'>
                  {column.icon}
                  <span className='text-caption font-semibold text-muted-foreground uppercase'>
                    {column.label}
                  </span>
                  <Badge variant='muted' size='xs' className='font-semibold'>
                    {col.length}
                  </Badge>
                </div>
              </div>

              {/* Cards — scrollable */}
              <SortableContext
                id={column.id}
                items={col.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {(() => {
                  const addTaskButton = onAddTask ? (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => onAddTask(column.id)}
                      className='w-full justify-start gap-1.5 text-caption text-muted-foreground hover:text-foreground h-auto px-2 py-1.5'
                    >
                      <Plus size={16} />
                      {intl.formatMessage({
                        id: 'board.addTask',
                        defaultMessage: 'Add task',
                      })}
                    </Button>
                  ) : null
                  return shouldVirtualize(
                    col.length,
                    BOARD_COLUMN_VIRTUALIZE_THRESHOLD
                  ) ? (
                    <VirtualColumnBody
                      columnId={column.id}
                      items={col}
                      renderCard={renderCard}
                      footer={addTaskButton}
                    />
                  ) : (
                    <DroppableColumn id={column.id}>
                      {col.map(task =>
                        keyedCard(task.id, renderCard(task, false))
                      )}
                      {addTaskButton}
                    </DroppableColumn>
                  )
                })()}
              </SortableContext>
            </div>
          )
        })}
      </div>

      {/* Drag overlay */}
      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.5' } },
          }),
        }}
      >
        {activeTask ? renderCard(activeTask, true) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** Inject a stable React key onto whatever the caller's renderCard returned, so
 * callers don't have to remember and we don't add an extra wrapper DOM element
 * (which would break dnd-kit's drag math). */
function keyedCard(key: string, node: ReactNode): ReactNode {
  if (isValidElement(node)) return cloneElement(node, { key })
  return node
}
