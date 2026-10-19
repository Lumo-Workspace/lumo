'use client'

import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { Hash, User, FolderOpen } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import type { Mention } from '@/lib/quick-dispatch/types'

export interface MentionCandidate {
  type: 'task' | 'project' | 'member'
  id: string
  label: string
  sublabel?: string
  identifier?: string
  title?: string
  name?: string
  actorId?: string
}

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  mentions: Mention[]
  onMentionsChange: (mentions: Mention[]) => void
  candidates: MentionCandidate[]
  placeholder?: string
  disabled?: boolean
  onSubmit?: () => void
  autoFocus?: boolean
}

const MAX_PER_GROUP = 8

const ICON_MAP = {
  task: Hash,
  project: FolderOpen,
  member: User,
} as const

function findAtPosition(value: string, cursorPos: number): number | null {
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') {
      // Make sure there's no space between @ and cursor (the query part)
      // But allow spaces in the query? No - stop at @, that's the anchor.
      return i
    }
    // If we hit a space before finding @, no active mention
    if (ch === ' ' && i < cursorPos - 1) {
      // Allow the query to contain no spaces for simplicity
      // Actually, let's allow: stop searching if we hit a character that can't be part of a mention query
      // For now, break on whitespace
      return null
    }
  }
  return null
}

export function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  candidates,
  placeholder,
  disabled,
  onSubmit,
  autoFocus,
}: MentionInputProps) {
  const intl = useIntl()
  const inputRef = useRef<HTMLInputElement>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [atPosition, setAtPosition] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      onChange(newValue)

      const cursorPos = e.target.selectionStart ?? newValue.length
      const atPos = findAtPosition(newValue, cursorPos)

      if (atPos !== null) {
        const searchQuery = newValue.slice(atPos + 1, cursorPos)
        setAtPosition(atPos)
        setQuery(searchQuery)
        setPopoverOpen(true)
      } else {
        setPopoverOpen(false)
        setAtPosition(null)
        setQuery('')
      }
    },
    [onChange]
  )

  const filteredCandidates = useMemo(() => {
    if (!popoverOpen) return { tasks: [], projects: [], members: [] }

    const lowerQuery = query.toLowerCase()
    const tasks: MentionCandidate[] = []
    const projects: MentionCandidate[] = []
    const members: MentionCandidate[] = []

    for (const candidate of candidates) {
      if (!candidate.label.toLowerCase().includes(lowerQuery)) continue

      if (candidate.type === 'task' && tasks.length < MAX_PER_GROUP) {
        tasks.push(candidate)
      } else if (
        candidate.type === 'project' &&
        projects.length < MAX_PER_GROUP
      ) {
        projects.push(candidate)
      } else if (
        candidate.type === 'member' &&
        members.length < MAX_PER_GROUP
      ) {
        members.push(candidate)
      }
    }

    return { tasks, projects, members }
  }, [popoverOpen, query, candidates])

  const handleSelect = useCallback(
    (candidate: MentionCandidate) => {
      if (atPosition === null) return

      const mentionLabel = candidate.label
      const before = value.slice(0, atPosition)
      const after = value.slice(atPosition + 1 + query.length)
      const insertedText = `@${mentionLabel} `
      const newValue = before + insertedText + after

      const mentionStart = atPosition
      const mentionEnd = atPosition + insertedText.trimEnd().length

      let mention: Mention
      if (candidate.type === 'task') {
        mention = {
          type: 'task',
          id: candidate.id,
          identifier: candidate.identifier ?? '',
          title: candidate.title ?? '',
          position: [mentionStart, mentionEnd],
        }
      } else if (candidate.type === 'project') {
        mention = {
          type: 'project',
          id: candidate.id,
          name: candidate.name ?? candidate.label,
          position: [mentionStart, mentionEnd],
        }
      } else {
        mention = {
          type: 'member',
          actorId: candidate.actorId ?? candidate.id,
          name: candidate.name ?? candidate.label,
          position: [mentionStart, mentionEnd],
        }
      }

      onChange(newValue)
      onMentionsChange([...mentions, mention])
      setPopoverOpen(false)
      setAtPosition(null)
      setQuery('')

      // Restore focus and cursor position after the inserted text
      const cursorTarget = before.length + insertedText.length
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.setSelectionRange(cursorTarget, cursorTarget)
        }
      })
    },
    [atPosition, value, query, mentions, onChange, onMentionsChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && popoverOpen) {
        e.preventDefault()
        setPopoverOpen(false)
        setAtPosition(null)
        setQuery('')
        return
      }

      if (e.key === 'Enter' && !popoverOpen) {
        e.preventDefault()
        onSubmit?.()
      }
    },
    [popoverOpen, onSubmit]
  )

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          type='text'
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className='w-full bg-transparent border-none p-0 text-title text-foreground placeholder:text-muted-foreground focus:ring-0 outline-none'
        />
      </PopoverAnchor>
      <PopoverContent
        className='w-[320px] p-0'
        align='start'
        sideOffset={8}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <Command>
          <CommandList>
            <CommandEmpty>
              {intl.formatMessage({ id: 'quickDispatch.noResults' })}
            </CommandEmpty>
            {filteredCandidates.tasks.length > 0 && (
              <CommandGroup
                heading={intl.formatMessage({
                  id: 'quickDispatch.mentionTasks',
                })}
              >
                {filteredCandidates.tasks.map(candidate => {
                  const Icon = ICON_MAP[candidate.type]
                  return (
                    <CommandItem
                      key={`task-${candidate.id}`}
                      onSelect={() => handleSelect(candidate)}
                    >
                      <Icon className='mr-2 h-4 w-4 shrink-0 text-muted-foreground' />
                      <span className='truncate'>{candidate.label}</span>
                      {candidate.sublabel && (
                        <span className='ml-auto text-caption text-muted-foreground truncate'>
                          {candidate.sublabel}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {filteredCandidates.projects.length > 0 && (
              <CommandGroup
                heading={intl.formatMessage({
                  id: 'quickDispatch.mentionProjects',
                })}
              >
                {filteredCandidates.projects.map(candidate => {
                  const Icon = ICON_MAP[candidate.type]
                  return (
                    <CommandItem
                      key={`project-${candidate.id}`}
                      onSelect={() => handleSelect(candidate)}
                    >
                      <Icon className='mr-2 h-4 w-4 shrink-0 text-muted-foreground' />
                      <span className='truncate'>{candidate.label}</span>
                      {candidate.sublabel && (
                        <span className='ml-auto text-caption text-muted-foreground truncate'>
                          {candidate.sublabel}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {filteredCandidates.members.length > 0 && (
              <CommandGroup
                heading={intl.formatMessage({
                  id: 'quickDispatch.mentionMembers',
                })}
              >
                {filteredCandidates.members.map(candidate => {
                  const Icon = ICON_MAP[candidate.type]
                  return (
                    <CommandItem
                      key={`member-${candidate.id}`}
                      onSelect={() => handleSelect(candidate)}
                    >
                      <Icon className='mr-2 h-4 w-4 shrink-0 text-muted-foreground' />
                      <span className='truncate'>{candidate.label}</span>
                      {candidate.sublabel && (
                        <span className='ml-auto text-caption text-muted-foreground truncate'>
                          {candidate.sublabel}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
