'use client'

import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A color chip for one token. `name` is the token base name, e.g. `primary` →
 * filled with `var(--primary)`. Inline CSS vars are used (not a `bg-${name}`
 * utility) because Tailwind only emits a utility whose exact literal class
 * string is found by the content scanner — a template literal like `bg-${name}`
 * is never expanded, so color tokens not used as `bg-<token>` literals elsewhere
 * (priority-*, warning, danger, most feedback sub-variants) would render
 * transparent. Every token has a real `--<name>` custom property on `:root`, so
 * `var(--<name>)` always resolves. `-foreground` / `-border` tokens render as
 * text / border samples so they stay legible.
 */
export function Swatch({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<string>('')
  const { resolvedTheme } = useTheme()

  const isBorder = name.endsWith('-border')
  const isForeground = name.endsWith('-foreground')
  const cssVar = `var(--${name})`

  // Re-resolve the computed value whenever the theme flips — the swatch fill
  // repaints on its own (it's a CSS var) but the displayed value string would
  // otherwise stay stale at its mount-time (light-mode) value.
  useEffect(() => {
    if (!ref.current) return
    const cs = getComputedStyle(ref.current)
    setValue(isBorder ? cs.borderColor : cs.backgroundColor)
  }, [isBorder, resolvedTheme])

  return (
    <div className='flex flex-col gap-1.5'>
      <div
        ref={ref}
        className={cn(
          'size-16 rounded-md border border-border',
          isBorder && 'bg-card'
        )}
        style={
          isBorder
            ? { borderWidth: 2, borderColor: cssVar }
            : { backgroundColor: cssVar }
        }
      >
        {isForeground ? (
          <span
            className='flex size-full items-center justify-center text-title'
            style={{ color: cssVar }}
          >
            Aa
          </span>
        ) : null}
      </div>
      <code className='text-caption text-foreground'>{name}</code>
      <code className='text-caption text-muted-foreground'>{value || '—'}</code>
    </div>
  )
}
