'use client'

import { List, LayoutGrid } from 'lucide-react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'

export function ViewToggle({
  value,
  onChange,
}: {
  value: 'list' | 'board'
  onChange: (v: 'list' | 'board') => void
}) {
  const intl = useIntl()
  return (
    // control-sm tall, so it lines up with the sm buttons beside it.
    <div className='inline-flex h-control-sm items-center gap-0.5 rounded-md border border-border p-0.5 bg-card'>
      {(['list', 'board'] as const).map(mode => (
        <button
          key={mode}
          type='button'
          onClick={() => onChange(mode)}
          className={cn(
            'inline-flex items-center justify-center h-6.5 w-7 rounded-sm transition-colors',
            value === mode
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-label={intl.formatMessage({
            id: mode === 'list' ? 'common.viewList' : 'common.viewBoard',
          })}
        >
          {mode === 'list' ? (
            <List className='h-4 w-4' />
          ) : (
            <LayoutGrid className='h-4 w-4' />
          )}
        </button>
      ))}
    </div>
  )
}
