'use client'

import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const COMMON_EMOJIS = [
  '📄',
  '📝',
  '📋',
  '📌',
  '📎',
  '📊',
  '📈',
  '📉',
  '🎯',
  '🚀',
  '💡',
  '🔧',
  '⚙️',
  '🏗️',
  '🎨',
  '🖊️',
  '📦',
  '🗂️',
  '📁',
  '📂',
  '🗃️',
  '🗄️',
  '📇',
  '🗑️',
  '✅',
  '❌',
  '⭐',
  '🔥',
  '💎',
  '🏆',
  '🎉',
  '🤖',
  '🐛',
  '🔒',
  '🔑',
  '🌍',
  '⚡',
  '🧪',
  '📐',
  '🧩',
]

interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='text-display hover:bg-muted rounded-md p-1 transition-colors'
        >
          {value || '📄'}
        </button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-2' align='start'>
        <div className='grid grid-cols-8 gap-1'>
          {COMMON_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type='button'
              className='text-heading p-1.5 rounded-sm hover:bg-muted transition-colors'
              onClick={() => {
                onChange(emoji)
                setOpen(false)
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
        {value && (
          <button
            type='button'
            className='w-full mt-2 text-caption text-muted-foreground hover:text-foreground py-1'
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            Remove emoji
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
