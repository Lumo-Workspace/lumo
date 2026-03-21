'use client'

import { List, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function ViewToggle({
  value,
  onChange,
}: {
  value: 'list' | 'board'
  onChange: (v: 'list' | 'board') => void
}) {
  return (
    <div className='flex items-center p-1 bg-zinc-100 dark:bg-zinc-900 rounded-md'>
      {(['list', 'board'] as const).map(mode => (
        <Button
          key={mode}
          variant='ghost'
          onClick={() => onChange(mode)}
          className={cn(
            'h-auto gap-1.5 text-[11px] font-medium px-3 py-1 rounded capitalize',
            value === mode
              ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm hover:bg-white dark:hover:bg-zinc-800'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          {mode === 'list' ? <List size={16} /> : <LayoutGrid size={16} />}
          {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </Button>
      ))}
    </div>
  )
}
