'use client'

import { Layers, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

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
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded transition-all capitalize',
            value === mode
              ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          {mode === 'list' ? <Layers size={16} /> : <LayoutGrid size={16} />}
          {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  )
}
