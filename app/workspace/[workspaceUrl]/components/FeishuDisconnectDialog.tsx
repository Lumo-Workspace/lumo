'use client'

import { useIntl } from 'react-intl'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'

/** LUM-1341 — the disconnect confirmation both Feishu cards share. */
export function FeishuDisconnectDialog({
  open,
  onOpenChange,
  disconnecting,
  onConfirm,
  titleId,
  descriptionId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  disconnecting: boolean
  onConfirm: () => void
  titleId: string
  descriptionId: string
}) {
  const intl = useIntl()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size='sm'>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intl.formatMessage({ id: titleId })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage({ id: descriptionId })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant='outline'>
            {intl.formatMessage({ id: 'common.cancel' })}
          </AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            onClick={onConfirm}
            disabled={disconnecting}
          >
            {disconnecting ? (
              <Spinner className='size-3.5' />
            ) : (
              intl.formatMessage({ id: 'common.disconnect' })
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
