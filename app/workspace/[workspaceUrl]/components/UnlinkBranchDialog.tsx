'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { tasksClient } from '@/lib/api-client'

interface UnlinkBranchDialogProps {
  isOpen: boolean
  onClose: () => void
  taskId: string
  branchId: string
  branchName: string
  onUnlinked: (branchId: string) => void
}

export function UnlinkBranchDialog({
  isOpen,
  onClose,
  taskId,
  branchId,
  branchName,
  onUnlinked,
}: UnlinkBranchDialogProps) {
  const intl = useIntl()
  const [deleteRemote, setDeleteRemote] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await tasksClient.unlinkBranch(taskId, branchId, deleteRemote)
      onUnlinked(branchId)
      onClose()
    } catch {
      toast.error('Failed to unlink branch')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !loading) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'task.unlinkBranch' })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: 'task.unlinkBranchConfirm' })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          <p className='text-xs font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-md px-3 py-2 truncate'>
            {branchName}
          </p>

          <label className='flex items-center gap-2 cursor-pointer'>
            <Checkbox
              checked={deleteRemote}
              onCheckedChange={v => setDeleteRemote(v === true)}
              disabled={loading}
            />
            <span className='text-xs text-zinc-600 dark:text-zinc-400'>
              {intl.formatMessage({ id: 'task.deleteRemoteBranch' })}
            </span>
          </label>

          <div className='flex gap-2'>
            <Button
              variant='outline'
              className='flex-1'
              onClick={onClose}
              disabled={loading}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              variant='destructive'
              className='flex-1'
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading && <Loader2 size={14} className='animate-spin mr-2' />}
              {loading
                ? intl.formatMessage({ id: 'task.unlinking' })
                : intl.formatMessage({ id: 'task.unlinkBranch' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
