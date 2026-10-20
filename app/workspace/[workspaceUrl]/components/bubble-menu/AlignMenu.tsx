'use client'

import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import { AlignLeft, AlignCenter, AlignRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useEditorSubmenu } from './useEditorSubmenu'

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
  const { open, setOpen, triggerProps, contentProps, itemProps } =
    useEditorSubmenu(editor)

  const activeFlags = [alignLeft, alignCenter, alignRight]
  const options = ALIGN_OPTIONS.map((o, i) => ({
    ...o,
    active: activeFlags[i] ?? false,
  }))
  const current = options.find(o => o.active) ?? options[0]!
  const label = intl.formatMessage({ id: 'editor.align' })

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label={label}
              {...triggerProps}
              className='flex items-center gap-1 px-1.5 h-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground transition-colors'
            >
              {current.icon}
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='start'
        className='min-w-[140px]'
        {...contentProps}
      >
        {options.map(o => (
          <DropdownMenuItem
            key={o.id}
            {...itemProps}
            onSelect={() => editor.chain().focus().setTextAlign(o.value).run()}
            className={cn(
              'hover:bg-accent hover:text-accent-foreground',
              o.active && 'bg-accent text-accent-foreground font-semibold'
            )}
          >
            {o.icon}
            {intl.formatMessage({ id: o.id })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
