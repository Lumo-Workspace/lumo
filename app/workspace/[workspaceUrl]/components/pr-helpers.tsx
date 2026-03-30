import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

export function PrStateBadge({ state }: { state: string }) {
  if (state === 'merged') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'>
        Merged
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'>
        Closed
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'>
      Open
    </span>
  )
}

export function CiIcon({ status }: { status: string | null }) {
  if (status === 'success')
    return <CheckCircle2 size={13} className='text-emerald-500 shrink-0' />
  if (status === 'failure')
    return <XCircle size={13} className='text-red-500 shrink-0' />
  if (status === 'pending')
    return <Loader2 size={13} className='text-zinc-400 shrink-0 animate-spin' />
  return null
}
