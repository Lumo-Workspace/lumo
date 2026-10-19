'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { ApiTask, MyTask, WorkspaceMemberInfo } from '../../types'
import { formatDueDate, isOverdue } from '../../utils'
import { PriorityBadge } from '../PriorityBadge'
import { MemberAvatar } from '../fields'
import { getInitials } from '@/lib/utils/getInitials'
import { UserCircle2 } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// ─── Shared card shell ────────────────────────────────────────────────────────

/**
 * Drag behavior of a card.
 *  - 'sortable': participates in @dnd-kit/sortable (default; project Kanban / My Tasks).
 *  - 'simple': participates only in cross-zone @dnd-kit/core useDraggable. Used by
 *    Sprint Planning where a card moves between Backlog ↔ Planned columns without
 *    needing within-column ordering. Pass `dragData` so the parent's onDragEnd can
 *    distinguish what was dragged.
 *  - 'none': no drag affordance, static card.
 */
export type DragMode = 'sortable' | 'simple' | 'none'

interface CardShellProps {
  taskId: string
  isOverlay: boolean
  needsAttention?: boolean
  onClick?: (() => void) | undefined
  children: React.ReactNode
  dragMode?: DragMode
  dragData?: Record<string, unknown>
}

function CardShell({
  taskId,
  isOverlay,
  needsAttention,
  onClick,
  children,
  dragMode = 'sortable',
  dragData,
}: CardShellProps) {
  const drag = useDragForMode(taskId, dragMode, dragData)
  const cursorClass =
    dragMode === 'none' ? '' : 'cursor-grab active:cursor-grabbing select-none'
  return (
    <div
      ref={drag.setNodeRef}
      style={drag.style}
      {...drag.attributes}
      {...drag.listeners}
      onClick={onClick}
      className={cn(
        'bg-card border border-border p-3 rounded-lg hover:border-muted-foreground/50 transition-colors',
        cursorClass,
        isOverlay &&
          'shadow-elevation-3 border-ring/50 rotate-2 cursor-grabbing',
        needsAttention && 'border-l-3 border-l-orange-400'
      )}
    >
      {children}
    </div>
  )
}

/** Branch on dragMode and return a uniform drag-binding shape. */
function useDragForMode(
  taskId: string,
  mode: DragMode,
  _data: Record<string, unknown> | undefined
) {
  // Only `useSortable` is wired — 'simple' mode is declared in the API but
  // no longer used in production, and calling `useDraggable` with the same
  // id wipes the droppable half of the sortable registration.
  const sortable = useSortable({ id: taskId, disabled: mode !== 'sortable' })

  if (mode === 'none') {
    return {
      setNodeRef: () => {},
      style: undefined as React.CSSProperties | undefined,
      attributes: {},
      listeners: {},
    }
  }
  if (mode === 'simple') {
    // No production caller uses this — fall through to sortable bindings to
    // avoid an unused `useDraggable` registration that would conflict with
    // useSortable's droppable.
  }
  return {
    setNodeRef: sortable.setNodeRef,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
      opacity: sortable.isDragging ? 0.4 : 1,
    } as React.CSSProperties,
    attributes: sortable.attributes,
    listeners: sortable.listeners,
  }
}

// ─── Project task card ────────────────────────────────────────────────────────

interface ProjectTaskCardProps {
  task: ApiTask
  isOverlay: boolean
  members?: WorkspaceMemberInfo[]
  /** Actor ID of the current logged-in user */
  currentActorId?: string | null | undefined
  /** Whether the current user is a workspace OWNER */
  isOwner?: boolean | undefined
  onClick?: () => void
  /** Drag behavior — see CardShell. Defaults to 'sortable' for backward compat. */
  dragMode?: DragMode
  /** Arbitrary metadata attached to the @dnd-kit drag event. Used when dragMode='simple'. */
  dragData?: Record<string, unknown>
}

export function ProjectTaskCard({
  task,
  isOverlay,
  members,
  currentActorId: _currentActorId,
  isOwner: _isOwner,
  onClick,
  dragMode,
  dragData,
}: ProjectTaskCardProps) {
  const assignee =
    members?.find(m => m.actorId === task.assigneeActorId) ?? null

  return (
    <CardShell
      taskId={task.id}
      isOverlay={isOverlay}
      onClick={onClick}
      {...(dragMode ? { dragMode } : {})}
      {...(dragData ? { dragData } : {})}
    >
      <div className='flex justify-between items-start mb-2'>
        {task.number === 0 ? (
          <Spinner className='size-3 text-muted-foreground' />
        ) : (
          <span className='text-caption font-mono text-muted-foreground'>
            {task.teamIdentifier}-{task.number}
          </span>
        )}
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className='text-body-strong mb-4 line-clamp-2'>{task.title}</h4>
      <div className='flex justify-between items-center'>
        {/* ── Left: avatar ── */}
        {assignee ? (
          <HoverCard openDelay={200}>
            <HoverCardTrigger asChild>
              <span
                className='cursor-default'
                onClick={e => e.stopPropagation()}
              >
                <MemberAvatar member={assignee} size='xs' />
              </span>
            </HoverCardTrigger>
            <HoverCardContent
              side='bottom'
              align='start'
              className='w-auto p-3'
            >
              <div className='flex items-center gap-3'>
                <Avatar className='size-8 shrink-0'>
                  <AvatarImage
                    src={assignee.imageUrl ?? undefined}
                    alt={assignee.name}
                  />
                  <AvatarFallback className='text-caption font-semibold'>
                    {getInitials(assignee.name)}
                  </AvatarFallback>
                </Avatar>
                <div className='flex flex-col min-w-0'>
                  <span className='text-caption font-semibold'>
                    {assignee.name}
                  </span>
                  {assignee.email && (
                    <span className='text-caption text-muted-foreground'>
                      {assignee.email}
                    </span>
                  )}
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        ) : (
          <UserCircle2 size={16} className='text-muted-foreground' />
        )}

        {/* ── Right: date ── */}
        <span
          className={cn(
            'text-caption',
            task.dueDate && isOverdue(task.dueDate)
              ? 'text-danger-text'
              : 'text-muted-foreground'
          )}
        >
          {task.dueDate
            ? `Due ${formatDueDate(task.dueDate)}`
            : `Created ${new Date(task.updatedAt).toLocaleDateString()}`}
        </span>
      </div>
    </CardShell>
  )
}

// ─── My-task card ─────────────────────────────────────────────────────────────

interface MyTaskCardProps {
  task: MyTask
  isOverlay: boolean
  onClick?: () => void
}

export function MyTaskCard({ task, isOverlay, onClick }: MyTaskCardProps) {
  const projectName = task.project?.name

  return (
    <CardShell taskId={task.id} isOverlay={isOverlay} onClick={onClick}>
      <div className='flex justify-between items-start mb-2'>
        {task.number === 0 ? (
          <Spinner className='size-3 text-muted-foreground' />
        ) : (
          <span className='text-caption font-mono text-muted-foreground'>
            {task.teamIdentifier}-{task.number}
          </span>
        )}
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className='text-body-strong mb-4 line-clamp-2'>{task.title}</h4>
      <div className='flex justify-between items-center'>
        <span className='text-caption text-muted-foreground truncate max-w-[140px]'>
          {projectName}
        </span>
        <span
          className={cn(
            'text-caption',
            task.dueDate && isOverdue(task.dueDate)
              ? 'text-danger-text'
              : 'text-muted-foreground'
          )}
        >
          {task.dueDate
            ? `Due ${formatDueDate(task.dueDate)}`
            : new Date(task.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </CardShell>
  )
}
