'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { RowListSkeleton } from './skeletons/RowListSkeleton'

interface AsyncContentProps {
  loading: boolean
  error?: string | null
  empty?: boolean
  /** Shows a retry link under the error; omitted = error text only. */
  onRetry?: () => void
  /** Skeleton shaped like the content; defaults to a few list rows. */
  loadingState?: React.ReactNode
  emptyState?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * The loading shell: a `role=status` region whose visible part is a
 * skeleton and whose label is read to screen readers only. `AsyncContent`
 * renders it while loading; components that return early before their data
 * exists render it directly.
 */
export function LoadingState({
  children,
  label,
  className,
}: {
  children?: React.ReactNode
  /** Screen-reader label; defaults to `common.loading`. */
  label?: string
  className?: string | undefined
}) {
  const intl = useIntl()
  return (
    <div role='status' aria-busy='true' className={cn('w-full', className)}>
      <span className='sr-only'>
        {label ?? intl.formatMessage({ id: 'common.loading' })}
      </span>
      {children ?? <RowListSkeleton />}
    </div>
  )
}

export function AsyncContent({
  loading,
  error = null,
  empty = false,
  onRetry,
  loadingState,
  emptyState,
  children,
  className,
}: AsyncContentProps) {
  const intl = useIntl()
  if (loading) {
    return <LoadingState className={className}>{loadingState}</LoadingState>
  }
  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-40 gap-2'>
        <p className='text-body text-danger-text'>{error}</p>
        {onRetry && (
          <Button
            variant='ghost'
            size='sm'
            onClick={onRetry}
            className='text-caption text-muted-foreground underline h-auto p-0 hover:bg-transparent hover:underline'
          >
            {intl.formatMessage({ id: 'common.retry' })}
          </Button>
        )}
      </div>
    )
  }
  if (empty) {
    return (
      <div className='flex flex-1 items-center justify-center p-8'>
        {emptyState ?? (
          <p className='text-body text-muted-foreground'>
            {intl.formatMessage({ id: 'common.empty' })}
          </p>
        )}
      </div>
    )
  }
  if (className) {
    return <div className={className}>{children}</div>
  }
  return <>{children}</>
}
