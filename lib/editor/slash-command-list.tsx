'use client'

import {
  useState,
  useEffect,
  useId,
  useLayoutEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react'
import type { SlashCommandItem } from './slash-command'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  /**
   * Accessible name for the listbox. Injected by the parent so this lib-layer
   * component stays free of react-intl.
   */
  label?: string
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command, label }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  // Stable per-instance prefix for aria-activedescendant (virtual listbox: the
  // editor keeps DOM focus while this tracks the active option).
  const baseId = useId()
  const optionId = (index: number) => `${baseId}-opt-${index}`

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  // Scroll selected item into view in the SAME paint as the highlight change.
  // useLayoutEffect runs after DOM commit but before paint, so the browser paints
  // the new highlight position and the new scroll offset together — no visible lag.
  // `behavior: 'instant'` overrides the global `html { scroll-behavior: smooth }`
  // so the scroll lands on the same frame instead of animating after the highlight.
  useLayoutEffect(() => {
    const el = itemRefs.current.get(selectedIndex)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [selectedIndex])

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (item) command(item)
    },
    [items, command]
  )

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex(prev => (prev - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex(prev => (prev + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null

  // Group by categoryKey (stable, never localized) to avoid re-grouping on
  // locale changes. The display label comes from the first item's `category`.
  const grouped = items.reduce<Record<string, SlashCommandItem[]>>(
    (acc, item) => {
      if (!acc[item.categoryKey]) acc[item.categoryKey] = []
      acc[item.categoryKey]!.push(item)
      return acc
    },
    {}
  )

  let globalIndex = 0

  return (
    <div className='z-50 w-56 rounded-lg border bg-popover shadow-elevation-3 overflow-hidden'>
      <div
        className='max-h-64 overflow-y-auto p-1'
        role='listbox'
        aria-label={label}
        aria-activedescendant={optionId(selectedIndex)}
      >
        {Object.entries(grouped).map(([categoryKey, categoryItems]) => {
          const categoryLabel = categoryItems[0]?.category ?? ''
          return (
          <div key={categoryKey} role='group' aria-label={categoryLabel}>
            <div className='px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider'>
              {categoryLabel}
            </div>
            {categoryItems.map(item => {
              const idx = globalIndex++
              return (
                <button
                  key={item.title}
                  id={optionId(idx)}
                  ref={el => {
                    if (el) itemRefs.current.set(idx, el)
                    else itemRefs.current.delete(idx)
                  }}
                  type='button'
                  role='option'
                  aria-selected={idx === selectedIndex}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                    idx === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                  onClick={() => selectItem(idx)}
                  onMouseMove={() => {
                    if (selectedIndex !== idx) setSelectedIndex(idx)
                  }}
                >
                  <span className='flex w-5 items-center justify-center shrink-0 text-muted-foreground'>
                    {item.icon}
                  </span>
                  <div className='min-w-0 text-left'>
                    <div className='font-medium'>{item.title}</div>
                    <div className='text-[10px] text-muted-foreground truncate'>
                      {item.description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          )
        })}
      </div>
    </div>
  )
})
