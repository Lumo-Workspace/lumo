'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'

// GitHub's PR state colours (user ruling, LUM-1245): open → success (green),
// merged → status-in-review (the only purple/magenta token family; reused here
// as GitHub's merged purple), closed → danger (red), draft → muted (grey).
export function PrStateBadge({ state }: { state: string }) {
  if (state === 'draft') {
    return (
      <Badge variant='muted' size='sm'>
        Draft
      </Badge>
    )
  }
  if (state === 'merged') {
    return (
      <Badge
        variant='plain'
        size='sm'
        className='bg-status-in-review-subtle text-status-in-review-text'
      >
        Merged
      </Badge>
    )
  }
  if (state === 'closed') {
    return (
      <Badge variant='danger' size='sm'>
        Closed
      </Badge>
    )
  }
  return (
    <Badge variant='success' size='sm'>
      Open
    </Badge>
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
    trigger = <Spinner className='size-[13px] text-muted-foreground shrink-0' />
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
