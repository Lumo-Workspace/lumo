'use client'

import { useIntl } from 'react-intl'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface NewApiKeyDialogProps {
  open: boolean
  keyValue: string | null
  copied: boolean
  onCopy: () => void
  onClose: () => void
}

export function NewApiKeyDialog({
  open,
  keyValue,
  copied,
  onCopy,
  onClose,
}: NewApiKeyDialogProps) {
  const intl = useIntl()

  return (
    <AlertDialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intl.formatMessage({ id: 'apiKeys.newKeyTitle' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage({ id: 'apiKeys.newKeyDesc' })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='flex items-center gap-2 my-2'>
          <code className='flex-1 text-caption bg-muted rounded-sm px-3 py-2 break-all font-mono'>
            {keyValue}
          </code>
          <Button
            variant='outline'
            size='sm'
            onClick={onCopy}
            aria-label={intl.formatMessage({
              id: copied ? 'cli.copied' : 'cli.copy',
            })}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction>
            {intl.formatMessage({ id: 'common.close' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
