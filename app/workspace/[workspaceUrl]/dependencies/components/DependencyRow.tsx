'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Check, X, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils'
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
function evidenceText(
  edge: DependencyEdge,
  intl: ReturnType<typeof useIntl>
): string | null {
  if (edge.source !== 'DETECTED' || !edge.reason) return null
  if (edge.reason === 'possible_duplicate') {
    // LUM-1286: suggested by the background check after `lumo task create`.
    const detail = edge.detail as { score?: number } | null
    return intl.formatMessage(
      { id: 'task.dependencies.evidence.possibleDuplicate' },
      { score: Math.round((detail?.score ?? 0) * 100) }
    )
  }
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
  const evidence = evidenceText(edge, intl)
  const [confirming, setConfirming] = useState(false)
  return (
    <div className='group flex min-w-0 items-center gap-2 py-1.5 text-body border-b border-border/50 last:border-b-0'>
      <span className='font-mono text-caption text-muted-foreground shrink-0 whitespace-nowrap'>
        {edge.other.identifier}
      </span>
      <span className='min-w-0 flex-1 truncate'>{edge.other.title}</span>
      {variant === 'confirmed' && (
        <>
          <span className='shrink-0 whitespace-nowrap'>
            <StatusBadge status={edge.other.status} size={14} />
          </span>
          {confirming ? (
            <span className='flex shrink-0 items-center gap-1.5'>
              <button
                type='button'
                disabled={busy}
                onClick={() => {
                  onRemove?.()
                  setConfirming(false)
                }}
                className='text-caption text-danger-text hover:underline'
              >
                {intl.formatMessage({ id: 'common.remove' })}
              </button>
              <button
                type='button'
                aria-label={intl.formatMessage({ id: 'common.cancel' })}
                onClick={() => setConfirming(false)}
                className='text-muted-foreground hover:text-foreground'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            </span>
          ) : (
            <button
              type='button'
              aria-label={intl.formatMessage({
                id: 'task.dependencies.remove',
              })}
              disabled={busy}
              onClick={() => setConfirming(true)}
              className='opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive'
            >
              <X className='h-3.5 w-3.5' />
            </button>
          )}
        </>
      )}
      {variant === 'suggested' && (
        <div className='flex items-center gap-1'>
          {evidence && (
            <span className='text-caption text-muted-foreground mr-1'>
              {evidence}
            </span>
          )}
          <button
            type='button'
            disabled={busy}
            onClick={() => onConfirm?.(false)}
            className={cn(
              'text-caption px-2 py-0.5 rounded-md border border-border hover:bg-accent',
              'text-success-text'
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
            className='text-caption px-2 py-0.5 rounded-md border border-border hover:bg-accent text-muted-foreground'
          >
            <ArrowLeftRight className='h-3 w-3' />
          </button>
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'task.dependencies.dismiss' })}
            disabled={busy}
            onClick={onDismiss}
            className='text-caption px-2 py-0.5 rounded-md border border-border hover:bg-accent text-muted-foreground'
          >
            <X className='h-3 w-3' />
          </button>
        </div>
      )}
    </div>
  )
}
