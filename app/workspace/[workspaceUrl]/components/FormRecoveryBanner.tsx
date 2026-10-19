'use client'

import { Lightbulb } from 'lucide-react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'

interface FormRecoveryBannerProps {
  onRestore: () => void
  onDiscard: () => void
}

export function FormRecoveryBanner({
  onRestore,
  onDiscard,
}: FormRecoveryBannerProps) {
  const intl = useIntl()

  return (
    <div className='flex items-center gap-2 rounded-md bg-info-subtle px-3 py-2 text-body text-info-text'>
      <Lightbulb className='size-4 shrink-0' />
      <span className='flex-1'>
        {intl.formatMessage({ id: 'drafts.recovery' })}
      </span>
      <Button
        variant='ghost'
        size='sm'
        className='h-6 px-2 text-caption text-info-text hover:bg-info/15'
        onClick={onRestore}
      >
        {intl.formatMessage({ id: 'drafts.restore' })}
      </Button>
      <Button
        variant='ghost'
        size='sm'
        className='h-6 px-2 text-caption text-info-text hover:bg-info/15'
        onClick={onDiscard}
      >
        {intl.formatMessage({ id: 'drafts.discard' })}
      </Button>
    </div>
  )
}
