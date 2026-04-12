'use client'

import { useIntl } from 'react-intl'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface RefreshReportButtonProps {
  state: 'idle' | 'generating' | 'cooldown'
  cooldownSeconds: number
  onRefresh: () => void
}

export function RefreshReportButton({
  state,
  cooldownSeconds,
  onRefresh,
}: RefreshReportButtonProps) {
  const intl = useIntl()

  const disabled = state !== 'idle'

  let label: string
  let icon: React.ReactNode

  switch (state) {
    case 'generating':
      label = intl.formatMessage({ id: 'summary.generating' })
      icon = <Loader2 size={14} className='animate-spin' />
      break
    case 'cooldown':
      label = intl.formatMessage(
        { id: 'summary.cooldown' },
        { seconds: cooldownSeconds }
      )
      icon = <RefreshCw size={14} className='text-zinc-400' />
      break
    default:
      label = intl.formatMessage({ id: 'summary.refreshReport' })
      icon = <RefreshCw size={14} />
  }

  return (
    <Button
      variant='ghost'
      size='sm'
      disabled={disabled}
      onClick={onRefresh}
      className='h-7 gap-1.5 text-xs'
    >
      {icon}
      {label}
    </Button>
  )
}
