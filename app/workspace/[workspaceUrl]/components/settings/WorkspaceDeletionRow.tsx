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
import { usePendingDeletion } from '../../hooks/usePendingDeletion'

type DialogMode = 'schedule' | 'deleteNow'

interface WorkspaceDeletionRowProps {
  workspaceName: string
  /** Called after the workspace is actually gone (delete-now path). */
  onDeleted: () => void
}

/**
 * LUM-918 — the delete-workspace row of the OWNER danger zone (LUM-1327:
 * the card itself is `DangerZoneCard`). Deleting schedules the purge 48h
 * out; while it is pending the row shows the deadline with cancel and
 * delete-now (the immediate-erasure path). Both destructive steps require
 * the workspace name to be typed.
 */
export function WorkspaceDeletionRow({
  workspaceName,
  onDeleted,
}: WorkspaceDeletionRowProps) {
  const intl = useIntl()
  const { pendingDeletion, schedule, cancel, deleteNow } = usePendingDeletion()
  const [mode, setMode] = useState<DialogMode | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  const closeDialog = () => {
    setMode(null)
    setConfirmName('')
  }

  const run = async (action: () => Promise<void>, failedId: string) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: failedId })
      )
    } finally {
      setBusy(false)
      closeDialog()
    }
  }

  const handleConfirm = () => {
    if (mode === 'schedule') {
      void run(async () => {
        await schedule()
        toast.success(intl.formatMessage({ id: 'workspaceDeletion.scheduled' }))
      }, 'workspaceSettings.deleteFailed')
    } else if (mode === 'deleteNow') {
      void run(async () => {
        await deleteNow(confirmName)
        onDeleted()
      }, 'workspaceSettings.deleteFailed')
    }
  }

  const handleCancel = () =>
    void run(async () => {
      await cancel()
      toast.success(intl.formatMessage({ id: 'workspaceDeletion.cancelled' }))
    }, 'workspaceDeletion.cancelFailed')

  const deadline = pendingDeletion
    ? intl.formatDate(pendingDeletion.executeAt, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : ''

  return (
    <>
      {pendingDeletion ? (
        <div className='flex items-center justify-between px-5 py-4 gap-4'>
          <div>
            <p className='text-body-strong text-foreground'>
              {intl.formatMessage({ id: 'workspaceDeletion.pendingTitle' })}
            </p>
            <p className='text-caption text-muted-foreground mt-0.5'>
              {intl.formatMessage(
                { id: 'workspaceDeletion.pendingDesc' },
                { date: deadline }
              )}
            </p>
          </div>
          <div className='flex shrink-0 gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={handleCancel}
            >
              {intl.formatMessage({ id: 'workspaceDeletion.cancel' })}
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={busy}
              onClick={() => setMode('deleteNow')}
            >
              {intl.formatMessage({ id: 'workspaceDeletion.deleteNow' })}
            </Button>
          </div>
        </div>
      ) : (
        <div className='flex items-center justify-between px-5 py-4'>
          <div>
            <p className='text-body-strong text-foreground'>
              {intl.formatMessage({ id: 'workspaceSettings.deleteTitle' })}
            </p>
            <p className='text-caption text-muted-foreground mt-0.5'>
              {intl.formatMessage({ id: 'workspaceSettings.deleteDesc' })}
            </p>
          </div>
          <Button
            variant='destructive'
            size='sm'
            onClick={() => setMode('schedule')}
            className='shrink-0 ml-4'
          >
            {intl.formatMessage({ id: 'workspaceSettings.deleteWorkspace' })}
          </Button>
        </div>
      )}

      <AlertDialog
        open={mode !== null}
        onOpenChange={open => {
          if (!open) closeDialog()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id:
                  mode === 'deleteNow'
                    ? 'workspaceDeletion.deleteNowTitle'
                    : 'workspaceSettings.deleteConfirmTitle',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                {
                  id:
                    mode === 'deleteNow'
                      ? 'workspaceDeletion.deleteNowDesc'
                      : 'workspaceSettings.deleteConfirmDesc',
                },
                { name: workspaceName }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='px-1 pb-2'>
            <p className='text-caption text-muted-foreground mb-1.5'>
              {intl.formatMessage(
                { id: 'workspaceSettings.deleteTypePrompt' },
                { name: workspaceName }
              )}
            </p>
            <input
              type='text'
              value={confirmName}
              onChange={e => setConfirmName(e.target.value)}
              placeholder={workspaceName}
              className='w-full h-9 rounded-md border border-border bg-transparent px-3 text-body outline-none focus:ring-2 focus:ring-danger'
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleConfirm}
              disabled={busy || confirmName !== workspaceName}
            >
              {busy
                ? intl.formatMessage({ id: 'common.deleting' })
                : intl.formatMessage({
                    id:
                      mode === 'deleteNow'
                        ? 'workspaceDeletion.deleteNow'
                        : 'workspaceSettings.deleteWorkspace',
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
