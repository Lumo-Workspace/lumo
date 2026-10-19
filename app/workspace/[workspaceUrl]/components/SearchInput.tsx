'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onFocus?: () => void
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  onFocus,
  className,
}: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground' />
      <Input
        type='text'
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        className='pl-8 h-8 text-caption'
      />
    </div>
  )
}
