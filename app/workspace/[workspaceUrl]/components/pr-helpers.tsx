'use client'

import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// GitHub's PR state colours (user ruling, LUM-1245): open → success (green),
// merged → status-in-review (the only purple/magenta token family; reused here
// as GitHub's merged purple), closed → danger (red), draft → muted (grey).
export function PrStateBadge({ state }: { state: string }) {
  if (state === 'draft') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption bg-muted text-muted-foreground'>
        Draft
      </span>
    )
  }
  if (state === 'merged') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption bg-status-in-review-subtle text-status-in-review-text'>
        Merged
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption bg-danger-subtle text-danger-text'>
        Closed
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption bg-success-subtle text-success-text'>
      Open
    </span>
  )
}

export function CiIcon({ status }: { status: string | null }) {
  const intl = useIntl()

  let trigger: React.ReactElement
  let labelId: string

  if (status === 'success') {
    trigger = <CheckCircle2 size={13} className='text-success-text shrink-0' />
    labelId = 'task.ciSuccess'
  } else if (status === 'failure') {
    trigger = <XCircle size={13} className='text-danger-text shrink-0' />
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
