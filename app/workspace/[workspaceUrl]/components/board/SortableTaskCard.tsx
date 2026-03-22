'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { ApiTask, MyTask, WorkspaceMemberInfo } from '../../types'
import { PriorityBadge } from '../PriorityBadge'
import { Spinner } from '@/components/ui/spinner'
import { MemberAvatar } from '../TaskFieldSelects'
import { UserCircle2 } from 'lucide-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// ─── Shared card shell ────────────────────────────────────────────────────────

interface CardShellProps {
  taskId: string
  isOverlay: boolean
  onClick?: (() => void) | undefined
  children: React.ReactNode
}

function CardShell({ taskId, isOverlay, onClick, children }: CardShellProps) {
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
      onClick={onClick}
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
  members?: WorkspaceMemberInfo[]
  onClick?: () => void
}

export function ProjectTaskCard({
  task,
  isOverlay,
  members,
  onClick,
}: ProjectTaskCardProps) {
  const assignee = members?.find(m => m.id === task.assigneeId) ?? null

  return (
    <CardShell taskId={task.id} isOverlay={isOverlay} onClick={onClick}>
      <div className='flex justify-between items-start mb-2'>
        {task.number ? (
          <span className='text-xs font-mono text-zinc-500 dark:text-zinc-400'>
            {task.teamIdentifier}-{task.number}
          </span>
        ) : (
          <Spinner className='size-3 text-zinc-400' />
        )}
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className='text-sm font-medium mb-4 leading-relaxed line-clamp-2'>
        {task.title}
      </h4>
      <div className='flex justify-between items-center'>
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
                  <AvatarFallback className='text-xs font-semibold'>
                    {assignee.name
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
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
        <span className='text-[10px] text-zinc-400'>
          Created {new Date(task.updatedAt).toLocaleDateString()}
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
  return (
    <CardShell taskId={task.id} isOverlay={isOverlay} onClick={onClick}>
      <div className='flex justify-between items-start mb-2'>
        <span className='text-[10px] text-zinc-400 truncate max-w-[140px]'>
          {task.project.name}
        </span>
        <div className='flex items-center gap-1.5'>
          {task.number ? (
            <span className='text-[10px] font-mono text-zinc-400'>
              {task.teamIdentifier}-{task.number}
            </span>
          ) : (
            <Spinner className='size-3 text-zinc-400' />
          )}
          <PriorityBadge priority={task.priority} />
        </div>
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
