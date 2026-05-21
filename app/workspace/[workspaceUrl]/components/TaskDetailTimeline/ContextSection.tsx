'use client'

import * as React from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/landing/ui/accordion'

interface Props {
  value: string
  label: string
  count: number
  icon?: React.ReactNode
  addSlot?: React.ReactNode
  children: React.ReactNode
}

export function ContextSection({
  value,
  label,
  count,
  icon,
  addSlot,
  children,
}: Props): React.ReactElement {
  // Forward dead-zone clicks (the gap before/after the + button) to the
  // AccordionTrigger so the entire row toggles the section.
  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      e.currentTarget
        .querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')
        ?.click()
    }
  }

  return (
    <AccordionItem
      value={value}
      className='border border-zinc-200 dark:border-zinc-800 rounded-md mb-2 last:mb-0'
    >
      <div
        className='flex items-center pr-2 cursor-pointer'
        onClick={handleRowClick}
      >
        <AccordionTrigger className='flex-1 cursor-pointer px-3 py-2 text-sm hover:no-underline'>
          <span className='flex items-center gap-2'>
            {icon}
            <span className='font-medium'>{label}</span>
            <span
              className='text-xs text-zinc-500 tabular-nums'
              aria-label={`${count} items`}
            >
              {count}
            </span>
          </span>
        </AccordionTrigger>
        {addSlot && (
          <div className='shrink-0 ml-2' onClick={e => e.stopPropagation()}>
            {addSlot}
          </div>
        )}
      </div>
      <AccordionContent className='px-3 pb-3'>{children}</AccordionContent>
    </AccordionItem>
  )
}
