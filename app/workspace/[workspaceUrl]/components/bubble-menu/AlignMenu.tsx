'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import { AlignLeft, AlignCenter, AlignRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const ALIGN_OPTIONS = [
  {
    id: 'editor.alignLeft',
    icon: <AlignLeft size={14} />,
    value: 'left' as const,
  },
  {
    id: 'editor.alignCenter',
    icon: <AlignCenter size={14} />,
    value: 'center' as const,
  },
  {
    id: 'editor.alignRight',
    icon: <AlignRight size={14} />,
    value: 'right' as const,
  },
]

export function AlignMenu({
  editor,
  alignLeft,
  alignCenter,
  alignRight,
}: {
  editor: Editor
  alignLeft: boolean
  alignCenter: boolean
  alignRight: boolean
}) {
  const intl = useIntl()
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

  const activeFlags = [alignLeft, alignCenter, alignRight]
  const options = ALIGN_OPTIONS.map((o, i) => ({
    ...o,
    active: activeFlags[i] ?? false,
  }))
  const current = options.find(o => o.active) ?? options[0]!
  const label = intl.formatMessage({ id: 'editor.align' })

  return (
    <div ref={ref} className='relative'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            aria-label={label}
            aria-haspopup='menu'
            aria-expanded={open}
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center gap-1 px-1.5 h-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors'
          >
            {current.icon}
            <ChevronDown size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {open && (
        <div
          role='menu'
          className='absolute top-full left-0 mt-1 z-dropdown min-w-[140px] bg-popover text-popover-foreground border border-border rounded-md shadow-elevation-3 py-1'
        >
          {options.map(o => (
            <button
              key={o.id}
              role='menuitem'
              type='button'
              onMouseDown={e => {
                e.preventDefault()
                editor.chain().focus().setTextAlign(o.value).run()
                setOpen(false)
              }}
              className={cn(
                'w-full text-left flex items-center gap-2 px-3 py-1.5 text-caption transition-colors',
                o.active
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {o.icon}
              {intl.formatMessage({ id: o.id })}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
