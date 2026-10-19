'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { Ban, Check, GitFork, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDependencies } from '../hooks/useDependencies'
import {
  groupDependencies,
  computeLiveBlockers,
} from '../dependencies/groupDependencies'
import { DependenciesSection } from '../dependencies/components/DependenciesSection'
import { FieldValueSkeleton, SeparatorDot } from './fields/shared'

interface TaskDependencyFieldProps {
  /** This task's LUM-N identifier. */
  taskIdentifier: string
  /** Workspace url slug, for building chip links. */
  workspaceUrl: string
}

const MAX_CHIPS = 3

export function TaskDependencyField({
  taskIdentifier,
  workspaceUrl,
}: TaskDependencyFieldProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const { edges, loading } = useDependencies({ taskId: taskIdentifier })

  const grouped = groupDependencies(edges)
  const hasLiveBlocker = computeLiveBlockers(edges).length > 0
  const blockers = grouped.blockedBy
  const shown = blockers.slice(0, MAX_CHIPS)
  const overflow = blockers.length - shown.length
  const blocksCount = grouped.blocks.length
  const suggestedCount = grouped.suggested.length
  const isEmpty =
    blockers.length === 0 &&
    blocksCount === 0 &&
    suggestedCount === 0 &&
    grouped.related.length === 0

  const manageLabel = intl.formatMessage({
    id: 'task.dependencies.field.manage',
  })

  // Count pieces for the manage trailing button. Each is its own element; a
  // leading separator renders only when something visible already precedes it
  // (a chip, the +N overflow, or an earlier piece) — separators are interior
  // only, never dangling (LUM-557 Fix A).
  const pieces: ReactNode[] = []
  if (blocksCount > 0) {
    pieces.push(
      <span key='blocks'>
        {intl.formatMessage(
          {
            id: 'task.dependencies.field.blocks',
            defaultMessage: 'blocks {count}',
          },
          { count: blocksCount }
        )}
      </span>
    )
  }
  if (suggestedCount > 0) {
    pieces.push(
      <span key='suggested' className='text-warning-text'>
        {intl.formatMessage(
          {
            id: 'task.dependencies.field.suggested',
            defaultMessage: '{count} suggested',
          },
          { count: suggestedCount }
        )}
      </span>
    )
  }

  // Has anything rendered to the LEFT of the manage button (chips or +N)?
  const hasPrecedingChips = shown.length > 0 || overflow > 0

  return (
    <>
      <div className='flex min-h-control-sm flex-wrap items-center gap-1 px-2 py-1 text-body'>
        {loading && edges.length === 0 ? (
          <FieldValueSkeleton />
        ) : isEmpty ? (
          <button
            type='button'
            onClick={() => setOpen(true)}
            className='flex items-center gap-1 text-muted-foreground hover:text-foreground'
          >
            <Plus className='h-3 w-3' />
            {intl.formatMessage({ id: 'task.dependencies.addDependency' })}
          </button>
        ) : (
          <>
            {hasLiveBlocker && (
              <>
                <Ban
                  data-testid='deps-blocked-indicator'
                  aria-hidden='true'
                  className='h-3.5 w-3.5 text-destructive shrink-0'
                />
                <span className='sr-only'>
                  {intl.formatMessage({
                    id: 'task.dependencies.field.blocked',
                  })}
                </span>
              </>
            )}
            {shown.map(e => {
              const satisfied = e.other.status === 'DONE'
              return (
                <Tooltip key={e.id}>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/workspace/${workspaceUrl}/my-tasks/${e.other.identifier}`}
                      data-blocker-state={satisfied ? 'satisfied' : 'live'}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-mono rounded-sm px-1',
                        satisfied
                          ? 'text-success-text hover:bg-success/10'
                          : 'text-danger-text hover:bg-destructive/10'
                      )}
                    >
                      {satisfied && <Check className='h-3 w-3' />}
                      {e.other.identifier}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    {e.other.identifier} · {e.other.title}
                  </TooltipContent>
                </Tooltip>
              )
            })}
            {overflow > 0 && (
              <button
                type='button'
                aria-label={manageLabel}
                onClick={() => setOpen(true)}
                className='text-muted-foreground hover:text-foreground rounded-sm px-1'
              >
                +{overflow}
              </button>
            )}
            <button
              type='button'
              aria-label={manageLabel}
              onClick={() => setOpen(true)}
              className='flex shrink-0 items-center gap-1 rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground'
            >
              {pieces.map((piece, i) => {
                const showSep = hasPrecedingChips || i > 0
                return (
                  <span key={i} className='flex items-center gap-1'>
                    {showSep && <SeparatorDot />}
                    {piece}
                  </span>
                )
              })}
              <Plus className='h-3 w-3' />
            </button>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-1.5'>
              <GitFork className='h-4 w-4' />
              {intl.formatMessage({ id: 'task.dependencies.title' })}
            </DialogTitle>
          </DialogHeader>
          <DependenciesSection taskIdentifier={taskIdentifier} embedded />
        </DialogContent>
      </Dialog>
    </>
  )
}
