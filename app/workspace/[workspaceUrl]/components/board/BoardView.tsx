'use client'

import { cloneElement, isValidElement, useState, type ReactNode } from 'react'
import {
  DndContext,
  closestCorners,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  defaultDropAnimationSideEffects,
  useDroppable,
  SensorDescriptor,
  SensorOptions,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { StatusIcon } from '../StatusIcon'
import { Button } from '@/components/ui/button'

// ─── Droppable column wrapper ─────────────────────────────────────────────────

function DroppableColumn({
  id,
  children,
  stretch,
}: {
  id: string
  children: React.ReactNode
  stretch?: boolean | undefined
}) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={
        stretch
          ? 'flex flex-1 flex-col pb-2'
          : 'board-col-scroll flex-1 overflow-y-auto space-y-3 min-h-[100px] pb-2'
      }
    >
      {children}
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

const STATUS_COLUMNS: BoardColumn[] = [
  { id: 'TODO', label: 'Todo', icon: <StatusIcon status='TODO' size={13} /> },
  {
    id: 'IN_PROGRESS',
    label: 'In Progress',
    icon: <StatusIcon status='IN_PROGRESS' size={13} />,
  },
  {
    id: 'IN_REVIEW',
    label: 'In Review',
    icon: <StatusIcon status='IN_REVIEW' size={13} />,
  },
  { id: 'DONE', label: 'Done', icon: <StatusIcon status='DONE' size={13} /> },
]

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
  /** Custom column list. Defaults to the four task-status columns. */
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
  columns = STATUS_COLUMNS,
  getColumnId = (t: T) => String((t as unknown as { status: string }).status),
}: BoardViewProps<T>) {
  // When orderingLabel is set, we intercept drag events to prevent reordering
  // but still show the drag overlay + hint. We track a local dragging ID
  // so the parent's state stays untouched.
  const [lockedDragId, setLockedDragId] = useState<string | null>(null)

  const effectiveActiveId = orderingLabel ? lockedDragId : activeId
  const activeTask = tasks.find(t => t.id === effectiveActiveId) ?? null

  const handleDragStart = orderingLabel
    ? (event: DragStartEvent) => {
        setLockedDragId(String(event.active.id))
      }
    : onDragStart

  const handleDragEnd = orderingLabel
    ? () => {
        setLockedDragId(null)
      }
    : onDragEnd

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={orderingLabel ? () => {} : onDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className='border-t border-zinc-200 dark:border-zinc-800 p-8 flex gap-3 flex-1 bg-zinc-50/50 dark:bg-zinc-900/10 overflow-x-auto'>
        {columns.map(column => {
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
                  <span className='text-xs font-semibold text-zinc-500 uppercase tracking-wider'>
                    {column.label}
                  </span>
                  <span className='bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold'>
                    {col.length}
                  </span>
                </div>
              </div>

              {/* Cards — scrollable */}
              <SortableContext
                id={column.id}
                items={col.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn
                  id={column.id}
                  stretch={!!(orderingLabel && effectiveActiveId)}
                >
                  {orderingLabel && effectiveActiveId ? (
                    <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700'>
                      <p className='text-sm text-zinc-400 dark:text-zinc-500 font-medium'>
                        Board ordered by {orderingLabel}
                      </p>
                    </div>
                  ) : (
                    <>
                      {col.map(task =>
                        keyedCard(task.id, renderCard(task, false))
                      )}
                      {onAddTask && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => onAddTask(column.id)}
                          className='w-full justify-start gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 h-auto px-2 py-1.5'
                        >
                          <Plus size={16} />
                          Add task
                        </Button>
                      )}
                    </>
                  )}
                </DroppableColumn>
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
