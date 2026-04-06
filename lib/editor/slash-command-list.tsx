'use client'

import {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react'
import type { SlashCommandItem } from './slash-command'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

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

  // Group by category
  const grouped = items.reduce<Record<string, SlashCommandItem[]>>(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = []
      acc[item.category]!.push(item)
      return acc
    },
    {}
  )

  let globalIndex = 0

  return (
    <div className='z-50 w-56 rounded-lg border bg-popover shadow-lg overflow-hidden'>
      <div className='max-h-64 overflow-y-auto p-1'>
        {Object.entries(grouped).map(([category, categoryItems]) => (
          <div key={category}>
            <div className='px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider'>
              {category}
            </div>
            {categoryItems.map(item => {
              const idx = globalIndex++
              return (
                <button
                  key={item.title}
                  type='button'
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    idx === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                  onClick={() => selectItem(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className='w-5 text-center shrink-0'>{item.icon}</span>
                  <div className='min-w-0'>
                    <div className='font-medium'>{item.title}</div>
                    <div className='text-[10px] text-muted-foreground truncate'>
                      {item.description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
})
