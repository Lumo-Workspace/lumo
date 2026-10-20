'use client'

import type { Editor } from '@tiptap/core'
import { Baseline } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useEditorSubmenu } from './useEditorSubmenu'
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
  const { open, setOpen, triggerProps, contentProps, itemProps } =
    useEditorSubmenu(editor)
  const swatchProps = {
    type: 'button' as const,
    onMouseDown: itemProps.onMouseDown,
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type='button'
              aria-label='Text color'
              {...triggerProps}
              className='flex items-center justify-center size-7 rounded-sm transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground'
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
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Text color</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-[200px] p-2' {...contentProps}>
        {/* Font colors */}
        <div className='text-caption text-muted-foreground mb-1'>
          Font color
        </div>
        <div className='flex gap-1 mb-2'>
          {FONT_COLORS.map(c => (
            <Tooltip key={c.value || 'default'}>
              <TooltipTrigger asChild>
                <button
                  {...swatchProps}
                  onClick={() => {
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
                  aria-label={c.label}
                >
                  A
                </button>
              </TooltipTrigger>
              <TooltipContent>{c.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Background colors */}
        <div className='text-caption text-muted-foreground mb-1'>
          Background
        </div>
        <div className='flex gap-1 mb-1'>
          {BG_COLORS_LIGHT.map(c => (
            <Tooltip key={c.value || 'none'}>
              <TooltipTrigger asChild>
                <button
                  {...swatchProps}
                  onClick={() => {
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
                  aria-label={c.label}
                >
                  {!c.value && (
                    <span className='block w-full h-full relative'>
                      <span className='absolute inset-0 flex items-center justify-center text-caption text-muted-foreground'>
                        ∅
                      </span>
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{c.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className='flex gap-1 mb-2'>
          {BG_COLORS_DARK.map(c => (
            <Tooltip key={c.value}>
              <TooltipTrigger asChild>
                <button
                  {...swatchProps}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .setHighlight({ color: c.value })
                      .run()
                    setOpen(false)
                  }}
                  className={cn(
                    'size-5 rounded-sm border transition-colors',
                    currentHighlight === c.value
                      ? 'border-ring'
                      : 'border-border hover:border-muted-foreground'
                  )}
                  style={{ backgroundColor: c.value }}
                  aria-label={c.label}
                />
              </TooltipTrigger>
              <TooltipContent>{c.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Reset */}
        <button
          {...swatchProps}
          onClick={() => {
            editor.chain().focus().unsetColor().unsetHighlight().run()
            setOpen(false)
          }}
          className='w-full text-center text-caption text-muted-foreground hover:text-foreground py-1 border-t border-border transition-colors'
        >
          Reset to default
        </button>
      </PopoverContent>
    </Popover>
  )
}
