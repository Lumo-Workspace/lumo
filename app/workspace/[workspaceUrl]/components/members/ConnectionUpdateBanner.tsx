'use client'

import { useIntl } from 'react-intl'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * LUM-1136: notice above the members table when agent connections run an
 * outdated CLI or skill. Rendering is the parent's call (count > 0, not
 * dismissed); this only lays it out.
 */
export function ConnectionUpdateBanner({
  count,
  onShowWho,
  onDismiss,
}: {
  count: number
  onShowWho: () => void
  onDismiss: () => void
}) {
  const intl = useIntl()
  return (
    <Alert variant='warning' role='status' className='pr-2'>
      <AlertTriangle aria-hidden />
      <AlertDescription className='-my-1.5 flex flex-wrap items-center gap-x-3 gap-y-1'>
        <span className='min-w-60 flex-1'>
          <span className='text-body-strong'>
            {intl.formatMessage({ id: 'members.banner.title' }, { count })}
          </span>{' '}
          {intl.formatMessage({ id: 'members.banner.body' })}
        </span>
        <Button variant='ghost' size='sm' onClick={onShowWho}>
          {intl.formatMessage({ id: 'members.banner.showWho' })}
        </Button>
        <Button
          variant='ghost'
          size='icon'
          onClick={onDismiss}
          aria-label={intl.formatMessage({ id: 'members.banner.dismiss' })}
        >
          <X size={14} />
        </Button>
      </AlertDescription>
    </Alert>
  )
}
