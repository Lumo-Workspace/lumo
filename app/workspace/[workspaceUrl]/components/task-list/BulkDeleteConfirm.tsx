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

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Number of tasks the user is about to delete — shown in the description. */
  count: number
  /** Disables both buttons + swaps action label to "Deleting…" while in flight. */
  deleting: boolean
  onConfirm: () => void
}

export function BulkDeleteConfirm({
  open,
  onOpenChange,
  count,
  deleting,
  onConfirm,
}: Props) {
  const intl = useIntl()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intl.formatMessage({
              id: 'task.bulkDeleteConfirmTitle',
              defaultMessage: 'Delete tasks?',
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage(
              {
                id: 'task.bulkDeleteConfirmDesc',
                defaultMessage:
                  'This will permanently delete {count, plural, one {# task} other {# tasks}}. This action cannot be undone.',
              },
              { count }
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            {intl.formatMessage({
              id: 'common.cancel',
              defaultMessage: 'Cancel',
            })}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={deleting}
            variant='destructive'
          >
            {deleting
              ? intl.formatMessage({
                  id: 'common.deleting',
                  defaultMessage: 'Deleting…',
                })
              : intl.formatMessage({
                  id: 'common.delete',
                  defaultMessage: 'Delete',
                })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
