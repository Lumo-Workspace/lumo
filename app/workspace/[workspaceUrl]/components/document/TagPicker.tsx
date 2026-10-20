'use client'

import { useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiTag } from '../../types'
import { TAG_CHIP_CLASS, tagChipStyle, tagColorScheme } from './tag-colors'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandItem, CommandList } from '@/components/ui/command'

// ── TagBadge (new version using ApiTag) ───────────────────────────────────

interface TagBadgeNewProps {
  tag: ApiTag
}

export function TagBadgeNew({ tag }: TagBadgeNewProps) {
  return (
    <Badge
      variant='plain'
      size='xs'
      shape='square'
      className={TAG_CHIP_CLASS}
      style={tagChipStyle(tagColorScheme(tag))}
    >
      {tag.name}
    </Badge>
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
  const anchorRef = useRef<HTMLDivElement>(null)

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

  // Enter / arrow keys are handled by the surrounding <Command>: Enter picks
  // the highlighted row (the first one by default), so only Backspace stays.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !input && selectedTags.length > 0) {
        const last = selectedTags[selectedTags.length - 1]
        if (last) removeTag(last.id)
      }
    },
    [input, selectedTags, removeTag]
  )

  const open =
    showSuggestions && (filteredSuggestions.length > 0 || !!canCreate)

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
          <div
            ref={anchorRef}
            className={cn(
              'flex flex-wrap items-center gap-1.5',
              triggerClassName
            )}
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
              value={input}
              onChange={e => {
                setInput(e.target.value)
                setShowSuggestions(true)
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
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
        </PopoverAnchor>
        <PopoverContent
          align='start'
          className='w-48 p-1'
          // Typing focus stays in the input; rows are picked by click or Enter.
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          onMouseDown={e => e.preventDefault()}
          onInteractOutside={e => {
            if (anchorRef.current?.contains(e.target as Node))
              e.preventDefault()
          }}
        >
          <CommandList>
            {filteredSuggestions.slice(0, 5).map(tag => (
              <CommandItem
                key={tag.id}
                value={tag.id}
                onSelect={() => addTag(tag)}
              >
                <TagBadgeNew tag={tag} />
              </CommandItem>
            ))}
            {canCreate && (
              <CommandItem
                value='__create__'
                disabled={creating}
                onSelect={handleCreate}
                className='gap-1.5 text-muted-foreground [&_svg]:size-3'
              >
                <Plus className='h-3 w-3' />
                {intl.formatMessage(
                  { id: 'tags.create', defaultMessage: 'Create "{name}"' },
                  { name: input.trim() }
                )}
              </CommandItem>
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  )
}
