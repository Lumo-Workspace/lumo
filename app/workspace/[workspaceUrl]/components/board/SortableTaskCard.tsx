'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { ApiTask, MyTask } from '../../types'
import { PriorityBadge } from '../PriorityBadge'

// ─── Shared card shell ────────────────────────────────────────────────────────

interface CardShellProps {
  taskId: string
  isOverlay: boolean
  children: React.ReactNode
}

function CardShell({ taskId, isOverlay, children }: CardShellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: taskId,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging && !isOverlay ? 0.4 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing select-none',
        isOverlay && 'shadow-xl border-blue-500/50 rotate-2 cursor-grabbing'
      )}
    >
      {children}
    </div>
  )
}

// ─── Project task card ────────────────────────────────────────────────────────

interface ProjectTaskCardProps {
  task: ApiTask
  isOverlay: boolean
}

export function ProjectTaskCard({ task, isOverlay }: ProjectTaskCardProps) {
  return (
    <CardShell taskId={task.id} isOverlay={isOverlay}>
      <div className='flex justify-between items-start mb-2'>
        <span className='text-[10px] font-mono text-zinc-400'>
          {task.id.slice(0, 8)}
        </span>
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className='text-sm font-medium mb-4 leading-relaxed line-clamp-2'>
        {task.title}
      </h4>
      <div className='flex justify-end'>
        <span className='text-[10px] text-zinc-400'>
          {new Date(task.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </CardShell>
  )
}

// ─── My-task card ─────────────────────────────────────────────────────────────

interface MyTaskCardProps {
  task: MyTask
  isOverlay: boolean
}

export function MyTaskCard({ task, isOverlay }: MyTaskCardProps) {
  return (
    <CardShell taskId={task.id} isOverlay={isOverlay}>
      <div className='flex justify-between items-start mb-2'>
        <span className='text-[10px] text-zinc-400 truncate max-w-[140px]'>
          {task.project.name}
        </span>
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className='text-sm font-medium mb-4 leading-relaxed line-clamp-2'>
        {task.title}
      </h4>
      <div className='flex justify-end'>
        <span className='text-[10px] text-zinc-400'>
          {new Date(task.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </CardShell>
  )
}
