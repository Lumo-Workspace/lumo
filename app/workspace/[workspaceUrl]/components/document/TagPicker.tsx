'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiTag } from '../../types'
import { TAG_PICKER_COLORS } from './tag-colors'

// ── Tag color helpers ─────────────────────────────────────────────────────

const DEFAULT_COLORS = TAG_PICKER_COLORS

function getTagColor(tag: ApiTag): { bg: string; text: string } {
  if (tag.color) {
    // Derive lighter bg from hex color
    return { bg: `${tag.color}20`, text: tag.color }
  }
  const hash = tag.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return DEFAULT_COLORS[hash % DEFAULT_COLORS.length] ?? DEFAULT_COLORS[0]!
}

// ── TagBadge (new version using ApiTag) ───────────────────────────────────

interface TagBadgeNewProps {
  tag: ApiTag
}

export function TagBadgeNew({ tag }: TagBadgeNewProps) {
  const color = getTagColor(tag)
  return (
    <span
      className='inline-flex items-center rounded-sm px-1.5 py-0.5 text-caption whitespace-nowrap'
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {tag.name}
    </span>
  )
}

// ── TagListNew ────────────────────────────────────────────────────────────

interface TagListNewProps {
  tags: ApiTag[]
  max?: number
}

export function TagListNew({ tags, max = 3 }: TagListNewProps) {
  if (tags.length === 0) return null
  const visible = tags.slice(0, max)
  const overflow = tags.length - max

  return (
    <div className='flex items-center gap-1'>
      {visible.map(tag => (
        <TagBadgeNew key={tag.id} tag={tag} />
      ))}
      {overflow > 0 && (
        <span className='text-caption text-muted-foreground'>+{overflow}</span>
      )}
    </div>
  )
}

// ── TagPicker ─────────────────────────────────────────────────────────────

interface TagPickerProps {
  /** Currently selected tags (full objects). */
  selectedTags: ApiTag[]
  /** All available tags in the workspace (for suggestions). */
  allTags: ApiTag[]
  /** Called when selected tags change. Receives the new full tag objects. */
  onChange: (tags: ApiTag[]) => void
  /** Called to create a new tag. Should return the created tag. */
  onCreateTag?: ((name: string) => Promise<ApiTag | null>) | undefined
  /** Extra classes merged into the inner trigger row — used to align with sibling field triggers. */
  triggerClassName?: string
}

export function TagPicker({
  selectedTags,
  allTags,
  onChange,
  onCreateTag,
  triggerClassName,
}: TagPickerProps) {
  const intl = useIntl()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedIds = new Set(selectedTags.map(t => t.id))

  const filteredSuggestions = allTags.filter(
    t =>
      t.name.toLowerCase().includes(input.toLowerCase()) &&
      !selectedIds.has(t.id)
  )

  const exactMatch = allTags.find(
    t => t.name.toLowerCase() === input.trim().toLowerCase()
  )
  const canCreate = input.trim().length > 0 && !exactMatch && onCreateTag

  const addTag = useCallback(
    (tag: ApiTag) => {
      if (!selectedIds.has(tag.id)) {
        onChange([...selectedTags, tag])
      }
      setInput('')
      setShowSuggestions(false)
    },
    [selectedTags, selectedIds, onChange]
  )

  const removeTag = useCallback(
    (tagId: string) => {
      onChange(selectedTags.filter(t => t.id !== tagId))
    },
    [selectedTags, onChange]
  )

  const handleCreate = useCallback(async () => {
    if (!onCreateTag || !input.trim() || creating) return
    setCreating(true)
    try {
      const tag = await onCreateTag(input.trim())
      if (tag) {
        addTag(tag)
      }
    } finally {
      setCreating(false)
    }
  }, [input, creating, onCreateTag, addTag])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredSuggestions.length > 0) {
          addTag(filteredSuggestions[0]!)
        } else if (canCreate) {
          handleCreate()
        }
      } else if (e.key === 'Backspace' && !input && selectedTags.length > 0) {
        const last = selectedTags[selectedTags.length - 1]
        if (last) removeTag(last.id)
      }
    },
    [
      input,
      selectedTags,
      filteredSuggestions,
      canCreate,
      addTag,
      removeTag,
      handleCreate,
    ]
  )

  return (
    <div className='relative'>
      <div
        className={cn('flex flex-wrap items-center gap-1.5', triggerClassName)}
      >
        {selectedTags.map(tag => (
          <span key={tag.id} className='inline-flex items-center gap-0.5'>
            <TagBadgeNew tag={tag} />
            <button
              onClick={() => removeTag(tag.id)}
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
            selectedTags.length === 0
              ? intl.formatMessage({
                  id: 'documents.tagPlaceholder',
                  defaultMessage: 'Add tags...',
                })
              : ''
          }
          className='bg-transparent text-caption outline-none min-w-[80px] flex-1 placeholder:text-muted-foreground'
        />
      </div>
      {showSuggestions && (filteredSuggestions.length > 0 || canCreate) && (
        <div className='absolute top-full left-0 mt-1 w-48 bg-popover border rounded-md shadow-elevation-2 z-dropdown py-1'>
          {filteredSuggestions.slice(0, 5).map(tag => (
            <button
              key={tag.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => addTag(tag)}
              className='flex items-center gap-2 w-full text-left px-3 py-1.5 text-body hover:bg-muted'
            >
              <TagBadgeNew tag={tag} />
            </button>
          ))}
          {canCreate && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={handleCreate}
              disabled={creating}
              className='flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-body hover:bg-muted text-muted-foreground'
            >
              <Plus className='h-3 w-3' />
              {intl.formatMessage(
                { id: 'tags.create', defaultMessage: 'Create "{name}"' },
                { name: input.trim() }
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
