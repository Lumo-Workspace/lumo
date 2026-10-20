'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { ApiStatus, ApiPriority, WorkspaceMemberInfo } from '../../types'
import { statusLabel } from '../../utils'
import { MemberAvatar, PRIORITY_CONFIG, PriorityDot } from '../fields/shared'

export function BulkStatusPicker({
  onPick,
}: {
  onPick: (s: ApiStatus) => void
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {intl.formatMessage({ id: 'task.status', defaultMessage: 'Status' })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(
              [
                'BACKLOG',
                'TODO',
                'IN_PROGRESS',
                'IN_REVIEW',
                'DONE',
                'CANCELED',
              ] as const
            ).map(s => (
              <CommandItem
                key={s}
                onSelect={() => {
                  onPick(s)
                  setOpen(false)
                }}
                className='gap-2'
              >
                {statusLabel(intl, s)}
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
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {intl.formatMessage({
            id: 'task.priority',
            defaultMessage: 'Priority',
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map(p => {
              const { label } = PRIORITY_CONFIG[p]
              return (
                <CommandItem
                  key={p}
                  onSelect={() => {
                    onPick(p)
                    setOpen(false)
                  }}
                  className='gap-2'
                >
                  <PriorityDot priority={p} />
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
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const assignableMembers = members.filter(m => m.actorId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {intl.formatMessage({
            id: 'task.assignee',
            defaultMessage: 'Assignee',
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandInput
            placeholder={intl.formatMessage({
              id: 'member.searchPlaceholder',
              defaultMessage: 'Search members…',
            })}
          />
          <CommandList>
            <CommandItem
              onSelect={() => {
                onPick(null)
                setOpen(false)
              }}
              className='gap-2 text-muted-foreground'
            >
              {intl.formatMessage({
                id: 'task.unassigned',
                defaultMessage: 'Unassigned',
              })}
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
                <MemberAvatar
                  decorative
                  name={m.name}
                  imageUrl={m.imageUrl}
                  size='xs'
                />
                {m.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
