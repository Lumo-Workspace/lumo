'use client'

import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { enUS, zhCN, zhTW } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const CALENDAR_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface DatePickerFieldProps {
  id?: string
  value: Date
  onChange: (d: Date) => void
  className?: string
  /** Visual style — full button on forms, ghost-text in inline contexts. */
  variant?: 'outline' | 'ghost'
}

export function DatePickerField({
  id,
  value,
  onChange,
  className,
  variant = 'outline',
}: DatePickerFieldProps) {
  const intl = useIntl()
  const locale = CALENDAR_LOCALES[intl.locale] ?? enUS
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant={variant}
          className={cn(
            variant === 'outline'
              ? 'w-full justify-start text-left font-normal'
              : 'h-auto px-1 py-0 font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          {variant === 'outline' && <CalendarDays className='mr-2 size-4' />}
          {formatDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[320px] p-0' align='start'>
        <Calendar
          mode='single'
          // Match the DueDate picker: stretch the calendar (and its inner
          // table) to the popover width so the cells have breathing room
          // instead of collapsing to --cell-size.
          className='w-full [&_[data-slot=calendar]]:w-full'
          style={{ '--cell-size': '2.5rem' } as React.CSSProperties}
          selected={value}
          defaultMonth={value}
          onSelect={d => {
            if (d) {
              onChange(startOfDay(d))
              setOpen(false)
            }
          }}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  )
}
