'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { FileText, ListTodo, Trash2 } from 'lucide-react'
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
import type { TrashItemView } from '@/lib/services/trash.service'
import { useTrash } from '../../hooks/useTrash'

/**
 * LUM-918 — settings → Trash. Deleted tasks (the whole workspace's) and the
 * caller's own deleted documents, each restorable until its purge date; an
 * item can also be deleted permanently right away.
 */
export function TrashSettingsPage() {
  const intl = useIntl()
  const { items, isLoading, isError, restore, deletePermanently } = useTrash()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [purging, setPurging] = useState<TrashItemView | null>(null)

  const formatDate = (iso: string) =>
    intl.formatDate(iso, { dateStyle: 'medium' })

  const handleRestore = async (item: TrashItemView) => {
    setBusyId(item.id)
    try {
      await restore(item.kind, item.id)
      toast.success(intl.formatMessage({ id: 'settings.trash.restored' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'settings.trash.restoreFailed' }))
    } finally {
      setBusyId(null)
    }
  }

  const handlePurge = async () => {
    if (!purging) return
    const item = purging
    setBusyId(item.id)
    try {
      await deletePermanently(item.kind, item.id)
      toast.success(intl.formatMessage({ id: 'settings.trash.purged' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'settings.trash.purgeFailed' }))
    } finally {
      setBusyId(null)
      setPurging(null)
    }
  }

  return (
    <div className='max-w-2xl mx-auto px-8 py-10'>
      <h1 className='text-heading text-foreground mb-1'>
        {intl.formatMessage({ id: 'settings.trash.title' })}
      </h1>
      <p className='text-body text-muted-foreground mb-6'>
        {intl.formatMessage({ id: 'settings.trash.description' })}
      </p>

      {isLoading ? (
        <div className='text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </div>
      ) : isError ? (
        <div className='text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'settings.trash.loadFailed' })}
        </div>
      ) : items.length === 0 ? (
        <div className='text-center py-12'>
          <Trash2 size={32} className='mx-auto mb-3 text-muted-foreground' />
          <p className='text-body-strong text-muted-foreground'>
            {intl.formatMessage({ id: 'settings.trash.empty' })}
          </p>
        </div>
      ) : (
        <ul className='rounded-lg border border-border divide-y divide-border'>
          {items.map(item => (
            <li
              key={`${item.kind}:${item.id}`}
              className='flex items-center gap-3 px-4 py-3'
            >
              {item.kind === 'task' ? (
                <ListTodo
                  size={16}
                  className='shrink-0 text-muted-foreground'
                />
              ) : (
                <FileText
                  size={16}
                  className='shrink-0 text-muted-foreground'
                />
              )}
              <div className='min-w-0 flex-1'>
                <p className='text-body text-foreground truncate'>
                  {item.kind === 'task' && (
                    <span className='text-muted-foreground mr-1.5'>
                      {item.label}
                    </span>
                  )}
                  {item.emoji && <span className='mr-1'>{item.emoji}</span>}
                  {item.title ||
                    intl.formatMessage({ id: 'settings.trash.untitled' })}
                </p>
                <p className='text-caption text-muted-foreground mt-0.5'>
                  {intl.formatMessage(
                    { id: 'settings.trash.meta' },
                    {
                      deleted: formatDate(item.deletedAt),
                      purge: formatDate(item.purgeAt),
                    }
                  )}
                  {item.descendantCount > 0 &&
                    ` · ${intl.formatMessage(
                      {
                        id:
                          item.kind === 'task'
                            ? 'settings.trash.withSubtasks'
                            : 'settings.trash.withSubpages',
                      },
                      { count: item.descendantCount }
                    )}`}
                </p>
              </div>
              <div className='flex shrink-0 gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busyId === item.id}
                  onClick={() => void handleRestore(item)}
                >
                  {intl.formatMessage({ id: 'settings.trash.restore' })}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-danger-text hover:text-danger-text'
                  disabled={busyId === item.id}
                  onClick={() => setPurging(item)}
                >
                  {intl.formatMessage({ id: 'settings.trash.deleteForever' })}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={purging !== null}
        onOpenChange={open => {
          if (!open) setPurging(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'settings.trash.purgeTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'settings.trash.purgeDesc' },
                { name: purging?.title ?? '' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={busyId !== null}
              onClick={() => void handlePurge()}
            >
              {intl.formatMessage({ id: 'settings.trash.deleteForever' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
