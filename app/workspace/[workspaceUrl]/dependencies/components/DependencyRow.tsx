'use client'

import { useIntl } from 'react-intl'
import { Check, X, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { StatusBadge } from '../../components/StatusBadge'
import type { DependencyEdge } from '../types'

interface DependencyRowProps {
  edge: DependencyEdge
  /** Suggested rows render confirm/reverse/dismiss; confirmed rows render remove. */
  variant: 'confirmed' | 'suggested'
  onConfirm?: (reverse: boolean) => void
  onDismiss?: () => void
  onRemove?: () => void
  busy?: boolean
}

/** Human-readable evidence line for a detected edge (reason + detail are untrusted; React escapes them). */
function evidenceText(edge: DependencyEdge): string | null {
  if (edge.source !== 'DETECTED' || !edge.reason) return null
  if (edge.reason === 'shared_files') {
    const detail = edge.detail as { count?: number } | null
    return detail?.count ? `shares ${detail.count} files` : 'shares files'
  }
  if (edge.reason === 'task_mention') return 'mentioned in description'
  return edge.reason
}

export function DependencyRow({
  edge,
  variant,
  onConfirm,
  onDismiss,
  onRemove,
  busy,
}: DependencyRowProps) {
  const intl = useIntl()
  const evidence = evidenceText(edge)
  return (
    <div className='group flex min-w-0 items-center gap-2 py-1.5 text-sm border-b border-border/50 last:border-b-0'>
      <span className='font-mono text-xs text-muted-foreground shrink-0 whitespace-nowrap'>
        {edge.other.identifier}
      </span>
      <span className='min-w-0 flex-1 truncate'>{edge.other.title}</span>
      {variant === 'confirmed' && (
        <>
          <span className='shrink-0 whitespace-nowrap'>
            <StatusBadge status={edge.other.status} size={14} />
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type='button'
                aria-label={intl.formatMessage({
                  id: 'task.dependencies.remove',
                })}
                disabled={busy}
                className='opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {intl.formatMessage({ id: 'task.dependencies.remove' })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {edge.other.identifier} · {edge.other.title}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {intl.formatMessage({ id: 'common.cancel' })}
                </AlertDialogCancel>
                <AlertDialogAction variant='destructive' onClick={onRemove}>
                  {intl.formatMessage({ id: 'common.remove' })}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {variant === 'suggested' && (
        <div className='flex items-center gap-1'>
          {evidence && (
            <span className='text-xs text-muted-foreground mr-1'>
              {evidence}
            </span>
          )}
          <button
            type='button'
            disabled={busy}
            onClick={() => onConfirm?.(false)}
            className={cn(
              'text-xs px-2 py-0.5 rounded-md border border-border hover:bg-accent',
              'text-success'
            )}
          >
            <Check className='h-3 w-3 inline mr-1' />
            {intl.formatMessage({ id: 'task.dependencies.confirm' })}
          </button>
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'task.dependencies.reverse' })}
            disabled={busy}
            onClick={() => onConfirm?.(true)}
            className='text-xs px-2 py-0.5 rounded-md border border-border hover:bg-accent text-muted-foreground'
          >
            <ArrowLeftRight className='h-3 w-3' />
          </button>
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'task.dependencies.dismiss' })}
            disabled={busy}
            onClick={onDismiss}
            className='text-xs px-2 py-0.5 rounded-md border border-border hover:bg-accent text-muted-foreground'
          >
            <X className='h-3 w-3' />
          </button>
        </div>
      )}
    </div>
  )
}
