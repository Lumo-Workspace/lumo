'use client'

import { useState } from 'react'
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
import { useDependencies } from '../hooks/useDependencies'
import {
  groupDependencies,
  computeLiveBlockers,
} from '../dependencies/groupDependencies'
import { DependenciesSection } from '../dependencies/components/DependenciesSection'

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
  const { edges } = useDependencies({ taskId: taskIdentifier })

  const grouped = groupDependencies(edges)
  const hasLiveBlocker = computeLiveBlockers(edges).length > 0
  const blockers = grouped.blockedBy
  const shown = blockers.slice(0, MAX_CHIPS)
  const overflow = blockers.length - shown.length
  const blocksCount = grouped.blocks.length
  const suggestedCount = grouped.suggested.length
  const isEmpty =
    blockers.length === 0 && blocksCount === 0 && suggestedCount === 0

  const trailing: string[] = []
  if (blocksCount > 0) {
    trailing.push(
      intl.formatMessage(
        {
          id: 'task.dependencies.field.blocks',
          defaultMessage: 'blocks {count}',
        },
        { count: blocksCount }
      )
    )
  }

  const manageLabel = intl.formatMessage({
    id: 'task.dependencies.field.manage',
  })

  return (
    <>
      <div className='flex flex-wrap items-center gap-1 px-2 py-1 text-xs min-h-7'>
        {isEmpty ? (
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
              <Ban
                data-testid='deps-blocked-indicator'
                aria-hidden='true'
                className='h-3.5 w-3.5 text-destructive shrink-0'
              />
            )}
            {shown.map(e => {
              const satisfied = e.other.status === 'DONE'
              return (
                <Link
                  key={e.id}
                  href={`/workspace/${workspaceUrl}/my-tasks/${e.other.identifier}`}
                  data-blocker-state={satisfied ? 'satisfied' : 'live'}
                  className={cn(
                    'inline-flex items-center gap-0.5 font-mono rounded-sm px-1',
                    satisfied
                      ? 'text-success hover:bg-success/10'
                      : 'text-destructive hover:bg-destructive/10'
                  )}
                >
                  {satisfied && <Check className='h-3 w-3' />}
                  {e.other.identifier}
                </Link>
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
              className='flex items-center gap-1 text-muted-foreground hover:text-foreground'
            >
              {trailing.length > 0 && (
                <>
                  <span aria-hidden='true'>·</span>
                  <span>{trailing.join(' · ')}</span>
                </>
              )}
              {suggestedCount > 0 && (
                <>
                  <span aria-hidden='true'>·</span>
                  <span className='text-warning'>
                    {intl.formatMessage(
                      {
                        id: 'task.dependencies.field.suggested',
                        defaultMessage: '{count} suggested',
                      },
                      { count: suggestedCount }
                    )}
                  </span>
                </>
              )}
              {trailing.length === 0 && suggestedCount === 0 && (
                <GitFork className='h-3 w-3' />
              )}
            </button>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-lg'>
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
