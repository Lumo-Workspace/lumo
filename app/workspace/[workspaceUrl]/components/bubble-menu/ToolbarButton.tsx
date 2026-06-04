'use client'

import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface ToolbarButtonProps {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  /**
   * Visual variant. `destructive` marks an action that removes content:
   * neutral when idle, red on hover, and solid red while `active` (e.g. armed
   * for a two-step confirm).
   */
  variant?: 'default' | 'destructive'
  children: React.ReactNode
}

export function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  variant = 'default',
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          onMouseDown={e => {
            e.preventDefault() // prevent editor blur
            if (!disabled) onClick()
          }}
          className={cn(
            'flex items-center justify-center size-7 rounded transition-colors',
            disabled
              ? 'opacity-40 cursor-not-allowed text-zinc-400 dark:text-zinc-600'
              : variant === 'destructive'
                ? active
                  ? 'bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'
                  : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 dark:hover:text-destructive'
                : active
                  ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

export function Divider() {
  return (
    <div className='w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5 shrink-0' />
  )
}
