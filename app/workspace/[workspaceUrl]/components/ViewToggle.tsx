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
    <div className='inline-flex items-center gap-1 rounded-md border border-border px-1 py-1 bg-card'>
      {(['list', 'board'] as const).map(mode => (
        <button
          key={mode}
          type='button'
          onClick={() => onChange(mode)}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-sm transition-colors',
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
