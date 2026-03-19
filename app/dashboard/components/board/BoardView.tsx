'use client'

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
import { Plus } from 'lucide-react'

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
    <div ref={setNodeRef} className='flex-1 space-y-3 min-h-[200px]'>
      {children}
    </div>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS = [
  { status: 'TODO' as const, label: 'Todo' },
  { status: 'IN_PROGRESS' as const, label: 'In Progress' },
  { status: 'IN_REVIEW' as const, label: 'In Review' },
  { status: 'DONE' as const, label: 'Done' },
]

// ─── BoardView ────────────────────────────────────────────────────────────────

interface BoardViewProps<
  T extends {
    id: string
    status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
    viewOrder: number | null
  },
> {
  tasks: T[]
  sensors: SensorDescriptor<SensorOptions>[]
  activeId: string | null
  onDragStart: (event: { active: { id: string | number } }) => void
  onDragOver: (event: DragOverEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  /** Render a task card. Pass isOverlay=true when rendering inside DragOverlay. */
  renderCard: (task: T, isOverlay: boolean) => React.ReactNode
  /** If provided, shows "Add task" button at the bottom of each column. */
  onAddTask?: () => void
}

export function BoardView<
  T extends {
    id: string
    status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
    viewOrder: number | null
  },
>({
  tasks,
  sensors,
  activeId,
  onDragStart,
  onDragOver,
  onDragEnd,
  renderCard,
  onAddTask,
}: BoardViewProps<T>) {
  const activeTask = tasks.find(t => t.id === activeId) ?? null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className='p-8 flex gap-6 h-full bg-zinc-50/50 dark:bg-zinc-900/10 overflow-x-auto items-start'>
        {COLUMNS.map(({ status, label }) => {
          const col = tasks
            .filter(t => t.status === status)
            .sort((a, b) => (a.viewOrder ?? 0) - (b.viewOrder ?? 0))
          return (
            <div key={status} className='w-80 min-w-[320px] flex flex-col'>
              {/* Column header */}
              <div className='flex items-center justify-between px-1 mb-3 shrink-0'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs font-semibold text-zinc-500 uppercase tracking-wider'>
                    {label}
                  </span>
                  <span className='bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold'>
                    {col.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <SortableContext
                id={status}
                items={col.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn id={status}>
                  {col.map(task => renderCard(task, false))}
                  {onAddTask && (
                    <button
                      onClick={onAddTask}
                      className='flex items-center gap-1.5 w-full text-left px-2 py-1.5 mt-1 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors'
                    >
                      <Plus size={16} />
                      Add task
                    </button>
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
