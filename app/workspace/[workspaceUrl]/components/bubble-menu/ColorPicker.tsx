'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Baseline } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const FONT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Gray', value: '#8c8c8c' },
  { label: 'Red', value: '#d83931' },
  { label: 'Orange', value: '#de7802' },
  { label: 'Yellow', value: '#dc9b04' },
  { label: 'Green', value: '#21a121' },
  { label: 'Blue', value: '#245bdb' },
  { label: 'Purple', value: '#6425d0' },
]

const BG_COLORS_LIGHT = [
  { label: 'None', value: '' },
  { label: 'Light Red', value: '#fde8e8' },
  { label: 'Light Orange', value: '#fef0e1' },
  { label: 'Light Yellow', value: '#fefce8' },
  { label: 'Light Green', value: '#e8fde8' },
  { label: 'Light Blue', value: '#e8f0fe' },
  { label: 'Light Purple', value: '#f0e8fe' },
]

const BG_COLORS_DARK = [
  { label: 'Gray', value: '#e2e2e2' },
  { label: 'Red', value: '#f9b4b4' },
  { label: 'Orange', value: '#fdd09b' },
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Green', value: '#b4f9b4' },
  { label: 'Blue', value: '#b4d0fe' },
  { label: 'Purple', value: '#d0b4fe' },
]

export interface ColorPickerProps {
  editor: Editor
  currentColor: string
  currentHighlight: string
}

export function ColorPicker({
  editor,
  currentColor,
  currentHighlight,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className='relative'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center justify-center size-7 rounded transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100'
          >
            <Baseline
              size={14}
              style={{
                color: currentColor || undefined,
                backgroundColor: currentHighlight || undefined,
                borderRadius: currentHighlight ? 2 : undefined,
              }}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>Text color</TooltipContent>
      </Tooltip>
      {open && (
        <div className='absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 w-[200px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-2'>
          {/* Font colors */}
          <div className='text-[10px] font-medium text-muted-foreground mb-1'>
            Font color
          </div>
          <div className='flex gap-1 mb-2'>
            {FONT_COLORS.map(c => (
              <button
                key={c.value || 'default'}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  if (c.value) {
                    editor.chain().focus().setColor(c.value).run()
                  } else {
                    editor.chain().focus().unsetColor().run()
                  }
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center justify-center size-5 rounded text-[11px] font-bold border transition-colors',
                  currentColor === c.value || (!currentColor && !c.value)
                    ? 'border-blue-500'
                    : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
                style={{ color: c.value || undefined }}
                title={c.label}
              >
                A
              </button>
            ))}
          </div>

          {/* Background colors */}
          <div className='text-[10px] font-medium text-muted-foreground mb-1'>
            Background
          </div>
          <div className='flex gap-1 mb-1'>
            {BG_COLORS_LIGHT.map(c => (
              <button
                key={c.value || 'none'}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  if (c.value) {
                    editor
                      .chain()
                      .focus()
                      .setHighlight({ color: c.value })
                      .run()
                  } else {
                    editor.chain().focus().unsetHighlight().run()
                  }
                  setOpen(false)
                }}
                className={cn(
                  'size-5 rounded border transition-colors',
                  currentHighlight === c.value ||
                    (!currentHighlight && !c.value)
                    ? 'border-blue-500'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                )}
                style={{ backgroundColor: c.value || 'transparent' }}
                title={c.label}
              >
                {!c.value && (
                  <span className='block w-full h-full relative'>
                    <span className='absolute inset-0 flex items-center justify-center text-[8px] text-zinc-400'>
                      ∅
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className='flex gap-1 mb-2'>
            {BG_COLORS_DARK.map(c => (
              <button
                key={c.value}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  editor.chain().focus().setHighlight({ color: c.value }).run()
                  setOpen(false)
                }}
                className={cn(
                  'size-5 rounded border transition-colors',
                  currentHighlight === c.value
                    ? 'border-blue-500'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                )}
                style={{ backgroundColor: c.value }}
                title={c.label}
              />
            ))}
          </div>

          {/* Reset */}
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              editor.chain().focus().unsetColor().unsetHighlight().run()
              setOpen(false)
            }}
            className='w-full text-center text-[11px] text-muted-foreground hover:text-foreground py-1 border-t border-zinc-100 dark:border-zinc-800 transition-colors'
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  )
}
