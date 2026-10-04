'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { useSessionRawRecord } from './useSessionRawRecord'

interface SessionRawRecordDeleteProps {
  sessionId: string
  /** Called after a delete finished, so the host can re-read its timeline. */
  onDeleted?: () => void
}

/**
 * LUM-944 — "delete this session's raw record". Rendered only for the
 * session's member or a workspace OWNER (the status read says which). The
 * confirm dialog states what is cleared, what is kept (event rows and
 * statistics, session / run summaries) and how many events an undispositioned
 * boundary crossing keeps.
 */
export function SessionRawRecordDelete({
  sessionId,
  onDeleted,
}: SessionRawRecordDeleteProps) {
  const intl = useIntl()
  const { status, remove } = useSessionRawRecord(sessionId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!status?.canDelete || status.totalEvents === 0) return null

  const handleConfirm = async () => {
    setBusy(true)
    try {
      const totals = await remove()
      toast.success(
        totals.keptForCrossings > 0
          ? intl.formatMessage(
              { id: 'sessionRecord.delete.doneWithKept' },
              { deleted: totals.deleted, kept: totals.keptForCrossings }
            )
          : intl.formatMessage(
              { id: 'sessionRecord.delete.done' },
              { count: totals.deleted }
            )
      )
      onDeleted?.()
    } catch {
      toast.error(intl.formatMessage({ id: 'sessionRecord.delete.failed' }))
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const last = status.lastDeletion
  const lastAt = last
    ? intl.formatDate(last.at, { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <section
      data-testid='session-raw-record'
      className='rounded-lg border border-border px-4 py-3'
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
        <div className='min-w-0 sm:flex-1'>
          <p className='text-sm font-medium text-foreground'>
            {intl.formatMessage({ id: 'sessionRecord.delete.title' })}
          </p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            {intl.formatMessage({ id: 'sessionRecord.delete.description' })}
          </p>
          {status.deleted > 0 && lastAt && (
            <p
              data-testid='session-raw-record-deleted'
              className='mt-1 text-xs text-muted-foreground'
            >
              {last?.byName
                ? intl.formatMessage(
                    { id: 'sessionRecord.delete.deletedStatusBy' },
                    { count: status.deleted, at: lastAt, name: last.byName }
                  )
                : intl.formatMessage(
                    { id: 'sessionRecord.delete.deletedStatus' },
                    { count: status.deleted, at: lastAt }
                  )}
            </p>
          )}
          {status.keptForCrossings > 0 && (
            <p
              data-testid='session-raw-record-kept'
              className='mt-1 text-xs text-warning-text'
            >
              {intl.formatMessage(
                { id: 'sessionRecord.delete.keptNotice' },
                { count: status.keptForCrossings }
              )}
            </p>
          )}
        </div>
        <div className='flex items-center gap-2 sm:shrink-0'>
          <Button
            variant='outline'
            size='sm'
            className='w-full text-destructive sm:w-auto'
            disabled={busy || status.deletable === 0}
            onClick={() => setOpen(true)}
          >
            {status.deletable === 0
              ? intl.formatMessage({ id: 'sessionRecord.delete.nothingLeft' })
              : intl.formatMessage({ id: 'sessionRecord.delete.button' })}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={next => {
          if (!next && !busy) setOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'sessionRecord.delete.confirmTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'sessionRecord.delete.confirmDesc' },
                { count: status.deletable }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='space-y-2 text-sm text-muted-foreground'>
            {status.keptForCrossings > 0 && (
              <p
                data-testid='session-raw-record-confirm-kept'
                className='text-warning-text'
              >
                {intl.formatMessage(
                  { id: 'sessionRecord.delete.confirmKept' },
                  { count: status.keptForCrossings }
                )}
              </p>
            )}
            <p>
              {intl.formatMessage({
                id: 'sessionRecord.delete.confirmSummaries',
              })}
            </p>
            <p>
              {intl.formatMessage({
                id: 'sessionRecord.delete.confirmIrreversible',
              })}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={e => {
                // keep the dialog open while the batched delete runs
                e.preventDefault()
                void handleConfirm()
              }}
              disabled={busy}
            >
              {busy
                ? intl.formatMessage({ id: 'common.deleting' })
                : intl.formatMessage({ id: 'sessionRecord.delete.confirm' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
