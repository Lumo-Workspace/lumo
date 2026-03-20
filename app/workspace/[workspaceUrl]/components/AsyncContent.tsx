'use client'

interface AsyncContentProps {
  loading: boolean
  error: string | null
  empty: boolean
  onRetry: () => void
  emptyMessage?: string
  children: React.ReactNode
}

export function AsyncContent({
  loading,
  error,
  empty,
  onRetry,
  emptyMessage = 'Nothing here yet.',
  children,
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
        <button onClick={onRetry} className='text-xs text-zinc-500 underline'>
          Retry
        </button>
      </div>
    )
  }
  if (empty) {
    return (
      <div className='flex items-center justify-center h-40 text-sm text-zinc-400'>
        {emptyMessage}
      </div>
    )
  }
  return <>{children}</>
}
