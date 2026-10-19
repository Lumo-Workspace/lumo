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
import { FONT_COLORS, BG_COLORS_LIGHT, BG_COLORS_DARK } from './editor-colors'

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
            aria-label='Text color'
            aria-haspopup='menu'
            aria-expanded={open}
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center justify-center size-7 rounded-sm transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground'
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
        <div
          role='menu'
          className='absolute top-full left-1/2 -translate-x-1/2 mt-1 z-dropdown w-[200px] bg-popover text-popover-foreground border border-border rounded-lg shadow-elevation-3 p-2'
        >
          {/* Font colors */}
          <div className='text-caption text-muted-foreground mb-1'>
            Font color
          </div>
          <div className='flex gap-1 mb-2'>
            {FONT_COLORS.map(c => (
              <button
                key={c.value || 'default'}
                role='menuitem'
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
                  'flex items-center justify-center size-5 rounded-sm text-caption font-semibold border transition-colors',
                  currentColor === c.value || (!currentColor && !c.value)
                    ? 'border-ring'
                    : 'border-transparent hover:border-muted-foreground'
                )}
                style={{ color: c.value || undefined }}
                title={c.label}
              >
                A
              </button>
            ))}
          </div>

          {/* Background colors */}
          <div className='text-caption text-muted-foreground mb-1'>
            Background
          </div>
          <div className='flex gap-1 mb-1'>
            {BG_COLORS_LIGHT.map(c => (
              <button
                key={c.value || 'none'}
                role='menuitem'
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
                  'size-5 rounded-sm border transition-colors',
                  currentHighlight === c.value ||
                    (!currentHighlight && !c.value)
                    ? 'border-ring'
                    : 'border-border hover:border-muted-foreground'
                )}
                style={{ backgroundColor: c.value || 'transparent' }}
                title={c.label}
              >
                {!c.value && (
                  <span className='block w-full h-full relative'>
                    <span className='absolute inset-0 flex items-center justify-center text-caption text-muted-foreground'>
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
                role='menuitem'
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  editor.chain().focus().setHighlight({ color: c.value }).run()
                  setOpen(false)
                }}
                className={cn(
                  'size-5 rounded-sm border transition-colors',
                  currentHighlight === c.value
                    ? 'border-ring'
                    : 'border-border hover:border-muted-foreground'
                )}
                style={{ backgroundColor: c.value }}
                title={c.label}
              />
            ))}
          </div>

          {/* Reset */}
          <button
            role='menuitem'
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              editor.chain().focus().unsetColor().unsetHighlight().run()
              setOpen(false)
            }}
            className='w-full text-center text-caption text-muted-foreground hover:text-foreground py-1 border-t border-border transition-colors'
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  )
}
