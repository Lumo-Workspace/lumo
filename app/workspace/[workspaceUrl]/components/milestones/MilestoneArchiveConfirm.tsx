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
  /** Milestone name, already extracted by the parent. */
  name: string
  /** Tasks still open under it — the number that makes archiving a decision. */
  remaining: number
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Archiving a milestone that still has open tasks is the one archive that can
 * lose work from view, so it asks first and says how many tasks are affected.
 * A finished milestone archives straight away — no dialog.
 */
export function MilestoneArchiveConfirm({
  name,
  remaining,
  onCancel,
  onConfirm,
}: Props) {
  const intl = useIntl()
  return (
    <AlertDialog open onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intl.formatMessage({ id: 'milestone.archiveConfirm.title' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage(
              { id: 'milestone.archiveConfirm.body' },
              { name, remaining }
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {intl.formatMessage({ id: 'milestone.archiveConfirm.confirm' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
