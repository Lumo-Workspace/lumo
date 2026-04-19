'use client'

import { useState } from 'react'
import { Trash2, ChevronDown } from 'lucide-react'
import { ApiStatus, ApiPriority, WorkspaceMemberInfo } from '../../types'
import { API_STATUS_LABEL } from '../../utils'
import { StatusIcon } from '../StatusIcon'
import { PRIORITY_CONFIG } from '../fields/shared'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandList,
  CommandItem,
  CommandInput,
} from '@/components/ui/command'
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

// ─── Individual pickers ────────────────────────────────────────────────────────

export function BulkStatusPicker({ onPick }: { onPick: (s: ApiStatus) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          Status
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const).map(s => (
              <CommandItem
                key={s}
                onSelect={() => {
                  onPick(s)
                  setOpen(false)
                }}
                className='gap-2'
              >
                <StatusIcon status={s} />
                {API_STATUS_LABEL[s] ?? s}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function BulkPriorityPicker({
  onPick,
}: {
  onPick: (p: ApiPriority) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          Priority
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map(p => {
              const { label, Icon, iconColor } = PRIORITY_CONFIG[p]
              return (
                <CommandItem
                  key={p}
                  onSelect={() => {
                    onPick(p)
                    setOpen(false)
                  }}
                  className='gap-2'
                >
                  <span className={iconColor}>
                    <Icon className='size-4' />
                  </span>
                  {label}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function BulkAssigneePicker({
  members,
  onPick,
}: {
  members: WorkspaceMemberInfo[]
  onPick: (actorId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const assignableMembers = members.filter(m => m.actorId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          Assignee
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandInput placeholder='Search members…' />
          <CommandList>
            <CommandItem
              onSelect={() => {
                onPick(null)
                setOpen(false)
              }}
              className='gap-2 text-zinc-400'
            >
              Unassigned
            </CommandItem>
            {assignableMembers.map(m => (
              <CommandItem
                key={m.actorId}
                onSelect={() => {
                  onPick(m.actorId)
                  setOpen(false)
                }}
                className='gap-2'
              >
                {m.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── TaskSelectionBar ──────────────────────────────────────────────────────────

interface TaskSelectionBarProps {
  selectedCount: number
  members: WorkspaceMemberInfo[]
  onStatusPick: (status: ApiStatus) => void
  onPriorityPick: (priority: ApiPriority) => void
  onAssigneePick: (actorId: string | null) => void
  onDelete: () => void
  onCancel: () => void
}

export function TaskSelectionBar({
  selectedCount,
  members,
  onStatusPick,
  onPriorityPick,
  onAssigneePick,
  onDelete,
  onCancel,
}: TaskSelectionBarProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    try {
      await Promise.resolve(onDelete())
    } finally {
      setDeleting(false)
      setConfirmDeleteOpen(false)
    }
  }

  if (selectedCount === 0) return null

  return (
    <>
      <div className='fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 px-6 h-12'>
        <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
          {selectedCount} selected
        </span>
        <div className='flex items-center gap-2'>
          <BulkStatusPicker onPick={onStatusPick} />
          <BulkPriorityPicker onPick={onPriorityPick} />
          <BulkAssigneePicker members={members} onPick={onAssigneePick} />
          <Button
            variant='destructive'
            size='sm'
            className='gap-1.5'
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 size={14} />
            Delete
          </Button>
          <Button variant='ghost' size='sm' onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedCount} task
              {selectedCount === 1 ? '' : 's'}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
