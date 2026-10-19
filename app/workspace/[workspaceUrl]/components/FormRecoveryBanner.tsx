'use client'

import { Lightbulb } from 'lucide-react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
    <Alert variant='info' role='status'>
      <Lightbulb />
      <AlertDescription className='-my-0.5 flex flex-wrap items-center gap-x-2 gap-y-1'>
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
      </AlertDescription>
    </Alert>
  )
}
