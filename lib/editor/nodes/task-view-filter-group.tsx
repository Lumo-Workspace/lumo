import type { ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'

export interface FilterOption {
  value: string
  label: string
  icon?: ReactNode
}

interface FilterCheckboxGroupProps {
  title: string
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
}

/**
 * Controlled multi-select section for the task-view config panel. Inline
 * checkbox rows (no nested popper → jsdom-friendly). Semantic tokens only.
 */
export function FilterCheckboxGroup({
  title,
  options,
  selected,
  onChange,
}: FilterCheckboxGroupProps) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value]
    )
  }
  return (
    <div className='space-y-1'>
      <p className='px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
        {title}
      </p>
      <div className='max-h-40 space-y-0.5 overflow-y-auto'>
        {options.map(opt => (
          <label
            key={opt.value}
            className='flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted'
          >
            <Checkbox
              checked={selected.includes(opt.value)}
              onCheckedChange={() => toggle(opt.value)}
              aria-label={opt.label}
            />
            {opt.icon}
            <span className='truncate'>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
