'use client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface DeleteDialogProps {
  show: boolean
  pageTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteDialog({
  show,
  pageTitle,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  return (
    <Dialog open={show} onOpenChange={onCancel}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>删除页面</DialogTitle>
          <DialogDescription>
            确定要删除「{pageTitle}
            」吗？此操作无法撤销，页面及其所有子页面都将被永久删除。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className='flex justify-end gap-3'>
          <Button
            variant='outline'
            onClick={onCancel}
            className='bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          >
            取消
          </Button>
          <Button
            variant='destructive'
            onClick={onConfirm}
            className='bg-red-600 hover:bg-red-700 text-white'
          >
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
