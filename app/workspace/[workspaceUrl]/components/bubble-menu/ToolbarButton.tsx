'use client'

import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
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
  /** For targeting in tests. */
  'data-testid'?: string
  children: React.ReactNode
}

export function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  variant = 'default',
  'data-testid': dataTestId,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          data-testid={dataTestId}
          onMouseDown={e => {
            e.preventDefault() // prevent editor blur
            if (!disabled) onClick()
          }}
          className={cn(
            'flex items-center justify-center size-7 rounded-sm transition-colors',
            disabled
              ? 'opacity-40 cursor-not-allowed text-muted-foreground'
              : variant === 'destructive'
                ? active
                  ? 'bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'
                  : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 dark:hover:text-destructive'
                : active
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
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
    <Separator
      orientation='vertical'
      className='mx-0.5 data-[orientation=vertical]:h-4'
    />
  )
}
