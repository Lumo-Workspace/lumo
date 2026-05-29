'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { MoreHorizontal } from 'lucide-react'
import type { MemoryRow } from '@/lib/api-client'
import { MemoryCard } from './MemoryCard'
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

interface MemoryListItemProps {
  memory: MemoryRow
  /** Task scope shows "Promote"; project scope hides it. */
  canPromote: boolean
  memberName?: string | undefined
  onEdit: (memory: MemoryRow) => void
  onPromote: (memory: MemoryRow) => void
  onDelete: (memory: MemoryRow) => void
}

export function MemoryListItem({
  memory,
  canPromote,
  memberName,
  onEdit,
  onPromote,
  onDelete,
}: MemoryListItemProps) {
  const intl = useIntl()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const source = memory.createdByMemberId
    ? intl.formatMessage({ id: 'memory.source.byMember' }, { name: memberName ?? '—' })
    : intl.formatMessage({ id: 'memory.source.auto' })

  return (
    <div className='relative group'>
      <MemoryCard
        item={{ id: memory.id, category: memory.category, content: memory.content }}
        showSedimentedLabel={false}
      />

      <div className='absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='size-7'
              aria-label={intl.formatMessage({ id: 'memory.action.menu' })}
            >
              <MoreHorizontal className='size-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onEdit(memory)}>
              {intl.formatMessage({ id: 'memory.action.edit' })}
            </DropdownMenuItem>
            {canPromote && (
              <DropdownMenuItem onClick={() => onPromote(memory)}>
                {intl.formatMessage({ id: 'memory.action.promote' })}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className='text-red-600' onClick={() => setConfirmOpen(true)}>
              {intl.formatMessage({ id: 'memory.action.delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className='text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 px-1'>{source}</p>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{intl.formatMessage({ id: 'memory.delete.confirm.title' })}</AlertDialogTitle>
            <AlertDialogDescription>{intl.formatMessage({ id: 'memory.delete.confirm.body' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{intl.formatMessage({ id: 'memory.dialog.cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-red-600 hover:bg-red-700'
              onClick={() => {
                setConfirmOpen(false)
                onDelete(memory)
              }}
            >
              {intl.formatMessage({ id: 'memory.action.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
