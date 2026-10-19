'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { TagBadge } from './TagBadge'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
}

export function TagInput({ tags, onChange, suggestions = [] }: TagInputProps) {
  const intl = useIntl()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
      if (e.key === 'Enter' && input.trim()) {
        e.preventDefault()
        addTag(input)
      } else if (e.key === 'Backspace' && !input && tags.length > 0) {
        const lastTag = tags[tags.length - 1]
        if (lastTag !== undefined) removeTag(lastTag)
      }
    },
    [input, tags, addTag, removeTag]
  )

  return (
    <div className='relative'>
      <div className='flex flex-wrap items-center gap-1.5'>
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
          ref={inputRef}
          value={input}
          onChange={e => {
            setInput(e.target.value)
            setShowSuggestions(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={
            tags.length === 0
              ? intl.formatMessage({ id: 'documents.tagPlaceholder' })
              : ''
          }
          className='bg-transparent text-body outline-none min-w-[80px] flex-1 placeholder:text-muted-foreground'
        />
      </div>
      {showSuggestions && input && filteredSuggestions.length > 0 && (
        <div className='absolute top-full left-0 mt-1 w-48 bg-popover border rounded-md shadow-elevation-2 z-dropdown py-1'>
          {filteredSuggestions.slice(0, 5).map(s => (
            <button
              key={s}
              onMouseDown={e => e.preventDefault()}
              onClick={() => addTag(s)}
              className='block w-full text-left px-3 py-1.5 text-body hover:bg-muted'
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
