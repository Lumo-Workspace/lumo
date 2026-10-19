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
  /** Already-translated question shown as the dialog title. */
  title: string
  /** Optional already-translated detail line under the title. */
  description?: string
  /** Already-translated label for the confirm button. */
  confirmLabel: string
  /** Destructive actions (delete / remove) get the destructive button. */
  destructive?: boolean
  /** Disables both buttons while the action is in flight. */
  pending?: boolean
  onConfirm: () => void
}

/**
 * LUM-1264: the in-app replacement for the browser's native confirm() prompt.
 * The caller owns the open state: open it from the trigger, then close it and
 * run the action from `onConfirm` (confirm does not auto-close). Cancel and Esc
 * close it without running anything.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: Props) {
  const intl = useIntl()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size='sm'>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {/* AlertDialog needs a description for screen readers; a one-line
              question reuses the title so nothing extra shows. */}
          <AlertDialogDescription className={description ? '' : 'sr-only'}>
            {description ?? title}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={e => {
              // The caller closes the dialog itself (before or after the
              // action), so a slow action can keep it open with `pending`.
              e.preventDefault()
              onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
