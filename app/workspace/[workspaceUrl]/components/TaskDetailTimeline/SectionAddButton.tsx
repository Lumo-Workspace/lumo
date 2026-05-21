'use client'

import { forwardRef } from 'react'
import { Plus } from 'lucide-react'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

export const SectionAddButton = forwardRef<HTMLButtonElement, Props>(
  function SectionAddButton({ label, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type='button'
        aria-label={label}
        title={label}
        className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
        {...rest}
      >
        <Plus size={14} />
      </button>
    )
  }
)
