'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A color chip for one token. `name` is the utility base name, e.g. `primary`
 * → painted with `bg-primary`. `-foreground` / `border` tokens render as text /
 * border samples so they stay legible.
 */
export function Swatch({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<string>('')

  useEffect(() => {
    if (!ref.current) return
    setValue(getComputedStyle(ref.current).backgroundColor)
  }, [])

  const isBorder = name.endsWith('-border')
  const isForeground = name.endsWith('-foreground')

  return (
    <div className='flex flex-col gap-1.5'>
      <div
        ref={ref}
        className={cn(
          'size-16 rounded-md border border-border',
          isBorder ? `border-2 border-${name} bg-card` : `bg-${name}`
        )}
      >
        {isForeground ? (
          <span className={cn('flex size-full items-center justify-center text-lg', `text-${name}`)}>
            Aa
          </span>
        ) : null}
      </div>
      <code className='text-caption text-foreground'>{name}</code>
      <code className='text-caption text-muted-foreground'>{value || '—'}</code>
    </div>
  )
}
