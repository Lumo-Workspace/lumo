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
import { useAiDerivedContent } from './useAiDerivedContent'

interface AiDerivedContentDeleteRowProps {
  workspaceName: string
}

/**
 * LUM-917 — the OWNER's delete of stored AI-derived content (memories with
 * their embeddings, session summaries, run summaries). Same row layout as
 * RetentionRow; the action needs the workspace name re-typed.
 */
export function AiDerivedContentDeleteRow({
  workspaceName,
}: AiDerivedContentDeleteRowProps) {
  const intl = useIntl()
  const { counts, purge } = useAiDerivedContent()
  const [open, setOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    setOpen(false)
    setConfirmName('')
  }

  const handleConfirm = async () => {
    setBusy(true)
    try {
      const deleted = await purge(confirmName)
      toast.success(
        intl.formatMessage(
          { id: 'dataRetention.aiDerivedDelete.done' },
          {
            memories: deleted.memories,
            sessionSummaries: deleted.sessionSummaries,
            runSummaries: deleted.runSummaries,
          }
        )
      )
    } catch {
      toast.error(
        intl.formatMessage({ id: 'dataRetention.aiDerivedDelete.failed' })
      )
    } finally {
      setBusy(false)
      close()
    }
  }

  const empty =
    counts !== null &&
    counts.memories + counts.sessionSummaries + counts.runSummaries === 0

  return (
    <div
      data-testid='retention-row-ai-derived-delete'
      className='px-5 py-4 border-b border-border last:border-b-0'
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
        <div className='min-w-0 sm:flex-1'>
          <p className='text-sm font-medium text-foreground'>
            {intl.formatMessage({ id: 'dataRetention.aiDerivedDelete.label' })}
          </p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            {intl.formatMessage({
              id: 'dataRetention.aiDerivedDelete.description',
            })}
          </p>
          {counts && (
            <p
              data-testid='ai-derived-counts'
              className='text-xs text-muted-foreground mt-1'
            >
              {intl.formatMessage(
                { id: 'dataRetention.aiDerivedDelete.counts' },
                {
                  memories: counts.memories,
                  sessionSummaries: counts.sessionSummaries,
                  runSummaries: counts.runSummaries,
                }
              )}
            </p>
          )}
        </div>
        <div className='flex items-center gap-2 sm:shrink-0'>
          <Button
            variant='destructive'
            size='sm'
            disabled={busy || empty}
            onClick={() => setOpen(true)}
          >
            {intl.formatMessage({ id: 'dataRetention.aiDerivedDelete.button' })}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={next => {
          if (!next && !busy) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id: 'dataRetention.aiDerivedDelete.confirmTitle',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'dataRetention.aiDerivedDelete.confirmDesc' },
                { name: workspaceName }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='px-1 pb-2'>
            <label
              htmlFor='ai-derived-confirm-name'
              className='block text-xs text-muted-foreground mb-1.5'
            >
              {intl.formatMessage(
                { id: 'workspaceSettings.deleteTypePrompt' },
                { name: workspaceName }
              )}
            </label>
            <input
              id='ai-derived-confirm-name'
              type='text'
              value={confirmName}
              onChange={e => setConfirmName(e.target.value)}
              placeholder={workspaceName}
              className='w-full h-9 rounded-md border border-border bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-danger'
            />
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
              disabled={busy || confirmName !== workspaceName}
            >
              {busy
                ? intl.formatMessage({ id: 'common.deleting' })
                : intl.formatMessage({
                    id: 'dataRetention.aiDerivedDelete.confirm',
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
