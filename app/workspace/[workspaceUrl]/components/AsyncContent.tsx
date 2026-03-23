'use client'

import { Button } from '@/components/ui/button'

interface AsyncContentProps {
  loading: boolean
  error: string | null
  empty: boolean
  onRetry: () => void
  emptyState?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function AsyncContent({
  loading,
  error,
  empty,
  onRetry,
  emptyState,
  children,
  className,
}: AsyncContentProps) {
  if (loading) {
    return (
      <div className='flex items-center justify-center h-40 text-sm text-zinc-400'>
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-40 gap-2'>
        <p className='text-sm text-red-500'>{error}</p>
        <Button
          variant='ghost'
          size='sm'
          onClick={onRetry}
          className='text-xs text-zinc-500 underline h-auto p-0 hover:bg-transparent hover:underline'
        >
          Retry
        </Button>
      </div>
    )
  }
  if (empty) {
    return (
      <div className='flex flex-1 items-center justify-center p-8'>
        {emptyState ?? (
          <p className='text-sm text-zinc-400'>Nothing here yet.</p>
        )}
      </div>
    )
  }
  if (className) {
    return <div className={className}>{children}</div>
  }
  return <>{children}</>
}
