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
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useMilestones } from '../../hooks/useMilestones'

interface Props {
  projectId: string
  /** undefined = no filter; null = "no milestone"; string = specific milestone id */
  value: string | null | undefined
  onChange: (v: string | null | undefined) => void
}

export function MilestoneFilterPicker({ projectId, value, onChange }: Props) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const { milestones } = useMilestones(projectId)

  const selectedLabel =
    value === null
      ? intl.formatMessage({ id: 'task.filter.milestone.none' })
      : value
        ? (milestones.find(m => m.id === value)?.name ??
          intl.formatMessage({ id: 'task.filter.milestone' }))
        : intl.formatMessage({ id: 'task.filter.milestone' })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} aria-hidden='true' />
          {selectedLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandInput
            placeholder={intl.formatMessage({
              id: 'milestone.search.placeholder',
            })}
          />
          <CommandList>
            <CommandEmpty>
              {intl.formatMessage({ id: 'milestone.search.empty' })}
            </CommandEmpty>
            <CommandItem
              onSelect={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              {intl.formatMessage({ id: 'task.filter.milestone' })}
            </CommandItem>
            <CommandItem
              onSelect={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              {intl.formatMessage({ id: 'task.filter.milestone.none' })}
            </CommandItem>
            {milestones.map(m => (
              <CommandItem
                key={m.id}
                value={m.name}
                onSelect={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
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
