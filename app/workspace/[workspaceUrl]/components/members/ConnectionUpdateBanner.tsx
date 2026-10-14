'use client'

import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <div
      role='status'
      className='flex flex-wrap items-center gap-3 rounded-lg border border-warning-border bg-warning-subtle py-2 pl-4 pr-2 text-sm text-foreground'
    >
      <span
        aria-hidden
        className='size-2 shrink-0 rounded-full bg-warning-text'
      />
      <span className='min-w-60 flex-1'>
        <span className='font-semibold'>
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
    </div>
  )
}
