'use client'

import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
  const intl = useIntl()

  let trigger: React.ReactElement
  let labelId: string

  if (status === 'success') {
    trigger = <CheckCircle2 size={13} className='text-emerald-500 shrink-0' />
    labelId = 'task.ciSuccess'
  } else if (status === 'failure') {
    trigger = <XCircle size={13} className='text-red-500 shrink-0' />
    labelId = 'task.ciFailure'
  } else if (status === 'pending') {
    trigger = (
      <Loader2
        size={13}
        className='text-muted-foreground shrink-0 animate-spin'
      />
    )
    labelId = 'task.ciPending'
  } else {
    trigger = (
      <span
        aria-hidden
        className='block w-[13px] h-[13px] shrink-0'
        data-testid='ci-icon-placeholder'
      />
    )
    labelId = 'task.ciUnknown'
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{intl.formatMessage({ id: labelId })}</TooltipContent>
    </Tooltip>
  )
}
