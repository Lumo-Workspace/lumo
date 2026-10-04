'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'

/**
 * Kebab menu + delete-confirmation for a sprint. Reused on the landing
 * cards (where the trigger sits inside a clickable Link, hence the
 * propagation guards) and on the detail page breadcrumb.
 */
export function SprintActionsMenu({
  sprint,
  onDeleted,
}: {
  sprint: Pick<Sprint, 'id' | 'name'>
  onDeleted: () => void
}) {
  const intl = useIntl()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await sprintsClient.remove(sprint.id)
      toast.success(intl.formatMessage({ id: 'sprints.detail.deleted' }))
      onDeleted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-7 text-muted-foreground'
            onClick={stop}
            aria-label={intl.formatMessage({
              id: 'sprints.detail.openActions',
            })}
          >
            <MoreHorizontal className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' onClick={stop}>
          <DropdownMenuItem
            className='text-danger-text focus:text-danger-text'
            onSelect={ev => {
              ev.preventDefault()
              setConfirmOpen(true)
            }}
          >
            <Trash2 className='size-4 mr-2' />
            {intl.formatMessage({ id: 'sprints.detail.deleteSprint' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent onClick={stop}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage(
                { id: 'sprints.detail.deleteConfirmTitle' },
                { name: sprint.name }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'sprints.detail.deleteConfirmBody' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {intl.formatMessage({ id: 'sprints.detail.deleteCancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {intl.formatMessage({ id: 'sprints.detail.deleteConfirm' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
