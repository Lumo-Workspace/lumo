'use client'

import { useSortable } from '@dnd-kit/sortable'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import {
  AgentStatusValue,
  ApiTask,
  MyTask,
  WorkspaceMemberInfo,
} from '../../types'
import { formatDueDate, isOverdue } from '../../utils'
import { PriorityBadge } from '../PriorityBadge'
import { MemberAvatar } from '../fields'
import { getInitials } from '@/lib/utils/getInitials'
import { UserCircle2, Bot } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// ─── Agent status helpers ──────────────────────────────────────────────────

const NEEDS_YOU_STATUSES: AgentStatusValue[] = ['INPUT_REQUIRED', 'FAILED']

function agentStatusLabel(
  status: AgentStatusValue | null | undefined
): string | null {
  switch (status) {
    case 'SUBMITTED':
      return 'Ready'
    case 'WORKING':
      return 'Working...'
    case 'INPUT_REQUIRED':
      return 'Needs you'
    case 'COMPLETED':
      return 'Done'
    case 'FAILED':
      return 'Failed'
    case 'CANCELED':
      return 'Canceled'
    default:
      return null
  }
}

function agentBadgeClasses(
  status: AgentStatusValue | null | undefined
): string {
  switch (status) {
    case 'SUBMITTED':
      return 'bg-zinc-400'
    case 'WORKING':
      return 'bg-blue-500 animate-pulse'
    case 'INPUT_REQUIRED':
      return 'bg-yellow-500'
    case 'COMPLETED':
      return 'bg-green-500'
    case 'FAILED':
      return 'bg-red-500'
    case 'CANCELED':
      return 'bg-zinc-400'
    default:
      return 'bg-zinc-400'
  }
}

function agentStatusTextClasses(
  status: AgentStatusValue | null | undefined
): string {
  switch (status) {
    case 'SUBMITTED':
      return 'text-zinc-400'
    case 'WORKING':
      return 'text-blue-500 animate-pulse'
    case 'INPUT_REQUIRED':
      return 'text-orange-500 font-medium'
    case 'COMPLETED':
      return 'text-green-600'
    case 'FAILED':
      return 'text-red-500'
    case 'CANCELED':
      return 'text-zinc-400'
    default:
      return 'text-zinc-400'
  }
}

/** 12px badge overlaid at bottom-right of the avatar */
function AgentStatusBadge({
  status,
}: {
  status: AgentStatusValue | null | undefined
}) {
  return (
    <span
      className={cn(
        'absolute -bottom-0.5 -right-0.5 size-3 rounded-sm border-2 border-white dark:border-zinc-900',
        agentBadgeClasses(status)
      )}
    />
  )
}

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
        'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow',
        cursorClass,
        isOverlay && 'shadow-xl border-blue-500/50 rotate-2 cursor-grabbing',
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
  data: Record<string, unknown> | undefined
) {
  // Hooks must be called unconditionally — we always call both, then pick.
  const sortable = useSortable({ id: taskId })
  const draggable = useDraggable({ id: taskId, data: data ?? {} })

  if (mode === 'none') {
    return {
      setNodeRef: () => {},
      style: undefined as React.CSSProperties | undefined,
      attributes: {},
      listeners: {},
    }
  }
  if (mode === 'simple') {
    return {
      setNodeRef: draggable.setNodeRef,
      style: {
        // Without this transform the element wouldn't visually follow the
        // cursor during drag — making it feel like nothing is happening.
        transform: CSS.Translate.toString(draggable.transform),
        opacity: draggable.isDragging ? 0.4 : 1,
      } as React.CSSProperties,
      attributes: draggable.attributes,
      listeners: draggable.listeners,
    }
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
  onParentClick?: (parentId: string) => void
  /** Drag behavior — see CardShell. Defaults to 'sortable' for backward compat. */
  dragMode?: DragMode
  /** Arbitrary metadata attached to the @dnd-kit drag event. Used when dragMode='simple'. */
  dragData?: Record<string, unknown>
}

export function ProjectTaskCard({
  task,
  isOverlay,
  members,
  currentActorId,
  isOwner,
  onClick,
  onParentClick,
  dragMode,
  dragData,
}: ProjectTaskCardProps) {
  const assignee =
    members?.find(m => m.actorId === task.assigneeActorId) ?? null
  const isAgent = task.assignee?.type === 'AGENT'
  const label = isAgent ? agentStatusLabel(task.agentStatus) : null

  // Orange border: INPUT_REQUIRED → reviewer or owner
  const needsAttention =
    isAgent &&
    task.agentStatus != null &&
    NEEDS_YOU_STATUSES.includes(task.agentStatus) &&
    (task.agentStatus === 'FAILED'
      ? !!isOwner
      : currentActorId === task.reviewerActorId || !!isOwner)

  return (
    <CardShell
      taskId={task.id}
      isOverlay={isOverlay}
      needsAttention={needsAttention}
      onClick={onClick}
      {...(dragMode ? { dragMode } : {})}
      {...(dragData ? { dragData } : {})}
    >
      <div className='flex justify-between items-start mb-2'>
        {task.number === 0 ? (
          <Spinner className='size-3 text-zinc-400' />
        ) : (
          <span className='text-xs font-mono text-zinc-500 dark:text-zinc-400'>
            {task.teamIdentifier}-{task.number}
          </span>
        )}
        <PriorityBadge priority={task.priority} />
      </div>
      {task.parent && (
        <div className='mb-1'>
          <button
            onClick={e => {
              e.stopPropagation()
              onParentClick?.(task.parent!.id)
            }}
            className='text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
          >
            ↑ {task.parent.teamIdentifier}-{task.parent.number}
          </button>
        </div>
      )}
      <h4 className='text-sm font-medium mb-4 leading-relaxed line-clamp-2'>
        {task.title}
      </h4>
      {(task._count?.children ?? 0) > 0 && (
        <div className='flex items-center gap-1.5 mt-1.5'>
          <div className='flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden'>
            <div
              className='h-full bg-blue-500 rounded-full transition-all'
              style={{
                width: `${Math.round(((task.childrenDoneCount ?? 0) / (task._count?.children ?? 1)) * 100)}%`,
              }}
            />
          </div>
          <span className='text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums'>
            {task.childrenDoneCount ?? 0}/{task._count?.children ?? 0}
          </span>
        </div>
      )}
      <div className='flex justify-between items-center'>
        {/* ── Left: avatar + agent badge ── */}
        {isAgent ? (
          <div className='relative shrink-0'>
            <div
              className='flex items-center justify-center size-5 rounded-full bg-violet-100 dark:bg-violet-900/40'
              title='Lumo Agent'
            >
              <Bot size={11} className='text-violet-600 dark:text-violet-400' />
            </div>
            <AgentStatusBadge status={task.agentStatus} />
          </div>
        ) : assignee ? (
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
                  <AvatarFallback className='text-xs font-semibold'>
                    {getInitials(assignee.name)}
                  </AvatarFallback>
                </Avatar>
                <div className='flex flex-col min-w-0'>
                  <span className='text-xs font-semibold'>{assignee.name}</span>
                  {assignee.email && (
                    <span className='text-[11px] text-muted-foreground'>
                      {assignee.email}
                    </span>
                  )}
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        ) : (
          <UserCircle2 size={16} className='text-zinc-300 dark:text-zinc-600' />
        )}

        {/* ── Right: status text or date ── */}
        {isAgent && label ? (
          <span
            className={cn(
              'text-[10px]',
              agentStatusTextClasses(task.agentStatus)
            )}
          >
            {label}
          </span>
        ) : (
          <span
            className={cn(
              'text-[10px]',
              task.dueDate && isOverdue(task.dueDate)
                ? 'text-red-500 font-medium'
                : 'text-zinc-400'
            )}
          >
            {task.dueDate
              ? `Due ${formatDueDate(task.dueDate)}`
              : `Created ${new Date(task.updatedAt).toLocaleDateString()}`}
          </span>
        )}
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
  const isAgent = task.assignee?.type === 'AGENT'
  const label = isAgent ? agentStatusLabel(task.agentStatus) : null

  return (
    <CardShell taskId={task.id} isOverlay={isOverlay} onClick={onClick}>
      <div className='flex justify-between items-start mb-2'>
        {task.number === 0 ? (
          <Spinner className='size-3 text-zinc-400' />
        ) : (
          <span className='text-xs font-mono text-zinc-500 dark:text-zinc-400'>
            {task.teamIdentifier}-{task.number}
          </span>
        )}
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className='text-sm font-medium mb-4 leading-relaxed line-clamp-2'>
        {task.title}
      </h4>
      {(task._count?.children ?? 0) > 0 && (
        <div className='flex items-center gap-1.5 mt-1.5'>
          <div className='flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden'>
            <div
              className='h-full bg-blue-500 rounded-full transition-all'
              style={{
                width: `${Math.round(((task.childrenDoneCount ?? 0) / (task._count?.children ?? 1)) * 100)}%`,
              }}
            />
          </div>
          <span className='text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums'>
            {task.childrenDoneCount ?? 0}/{task._count?.children ?? 0}
          </span>
        </div>
      )}
      <div className='flex justify-between items-center'>
        <span className='text-[10px] text-zinc-400 truncate max-w-[140px]'>
          {projectName}
        </span>
        {isAgent && label ? (
          <span
            className={cn(
              'text-[10px]',
              agentStatusTextClasses(task.agentStatus)
            )}
          >
            {label}
          </span>
        ) : (
          <span
            className={cn(
              'text-[10px]',
              task.dueDate && isOverdue(task.dueDate)
                ? 'text-red-500 font-medium'
                : 'text-zinc-400'
            )}
          >
            {task.dueDate
              ? `Due ${formatDueDate(task.dueDate)}`
              : new Date(task.updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </CardShell>
  )
}
