'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { TagBadge } from './TagBadge'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandItem, CommandList } from '@/components/ui/command'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
}

export function TagInput({ tags, onChange, suggestions = [] }: TagInputProps) {
  const intl = useIntl()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  // Enter adds the typed text unless the user arrowed onto a suggestion, in
  // which case the surrounding <Command> picks the highlighted row.
  const navigatedRef = useRef(false)

  const filteredSuggestions = suggestions.filter(
    s => s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s)
  )

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim()
      if (trimmed && !tags.includes(trimmed)) {
        onChange([...tags, trimmed])
      }
      setInput('')
      setShowSuggestions(false)
      navigatedRef.current = false
    },
    [tags, onChange]
  )

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter(t => t !== tag))
    },
    [tags, onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        navigatedRef.current = true
      } else if (e.key === 'Enter' && input.trim() && !navigatedRef.current) {
        e.preventDefault()
        addTag(input)
      } else if (e.key === 'Backspace' && !input && tags.length > 0) {
        const lastTag = tags[tags.length - 1]
        if (lastTag !== undefined) removeTag(lastTag)
      }
    },
    [input, tags, addTag, removeTag]
  )

  const open = showSuggestions && !!input && filteredSuggestions.length > 0

  return (
    <Command
      shouldFilter={false}
      className='h-auto w-auto overflow-visible rounded-none bg-transparent text-inherit'
    >
      <Popover
        open={open}
        onOpenChange={next => {
          if (!next) setShowSuggestions(false)
        }}
      >
        <PopoverAnchor asChild>
          <div ref={anchorRef} className='flex flex-wrap items-center gap-1.5'>
            {tags.map(tag => (
              <span key={tag} className='inline-flex items-center gap-0.5'>
                <TagBadge tag={tag} />
                <button
                  onClick={() => removeTag(tag)}
                  className='text-muted-foreground hover:text-foreground p-0.5'
                >
                  <X className='h-3 w-3' />
                </button>
              </span>
            ))}
            <input
              value={input}
              onChange={e => {
                setInput(e.target.value)
                setShowSuggestions(true)
                navigatedRef.current = false
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              placeholder={
                tags.length === 0
                  ? intl.formatMessage({ id: 'documents.tagPlaceholder' })
                  : ''
              }
              className='bg-transparent text-body outline-none min-w-[80px] flex-1 placeholder:text-muted-foreground'
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align='start'
          className='w-48 p-1'
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          onMouseDown={e => e.preventDefault()}
          onInteractOutside={e => {
            if (anchorRef.current?.contains(e.target as Node))
              e.preventDefault()
          }}
        >
          <CommandList>
            {filteredSuggestions.slice(0, 5).map(s => (
              <CommandItem key={s} value={s} onSelect={() => addTag(s)}>
                {s}
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  )
}
