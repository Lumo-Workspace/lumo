'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { usePendingDeletion } from '../hooks/usePendingDeletion'

/**
 * LUM-918 — shown to every member while the workspace is scheduled for
 * deletion, with the deadline; owners get the cancel button inline.
 */
export function WorkspaceDeletionBanner() {
  const intl = useIntl()
  const { pendingDeletion, isOwner, cancel } = usePendingDeletion()
  const [cancelling, setCancelling] = useState(false)

  if (!pendingDeletion) return null

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await cancel()
      toast.success(intl.formatMessage({ id: 'workspaceDeletion.cancelled' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'workspaceDeletion.cancelFailed' }))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div
      role='alert'
      className='flex items-center justify-between gap-3 px-4 py-2 text-sm border-b border-danger-border bg-danger-subtle text-danger-text'
    >
      <p>
        {intl.formatMessage(
          { id: 'workspaceDeletion.bannerPending' },
          {
            date: intl.formatDate(pendingDeletion.executeAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          }
        )}
      </p>
      {isOwner && (
        <Button
          size='sm'
          variant='outline'
          className='shrink-0'
          disabled={cancelling}
          onClick={handleCancel}
        >
          {intl.formatMessage({ id: 'workspaceDeletion.cancel' })}
        </Button>
      )}
    </div>
  )
}
