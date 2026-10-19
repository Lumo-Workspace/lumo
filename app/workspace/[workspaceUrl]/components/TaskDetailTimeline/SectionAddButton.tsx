'use client'

import { forwardRef } from 'react'
import { Plus } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

export const SectionAddButton = forwardRef<HTMLButtonElement, Props>(
  function SectionAddButton({ label, ...rest }, ref) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            type='button'
            aria-label={label}
            className='text-muted-foreground hover:text-foreground transition-colors'
            {...rest}
          >
            <Plus size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }
)
