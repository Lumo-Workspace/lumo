'use client'

import { useState, type ReactElement } from 'react'
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
import { formatCalendarDate } from '@/lib/datetime/format'

const CALENDAR_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function formatDate(date: Date | string, locale?: string): string {
  // Sprint dates are calendar days — render pinned to UTC so "Jun 1" is Jun 1
  // for every viewer regardless of browser timezone. `locale` is the active
  // react-intl locale so dates follow the app's chosen language.
  return formatCalendarDate(date, locale)
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
  return (
    <CalendarPopover
      selected={value}
      onSelect={d => {
        if (d) onChange(startOfDay(d))
      }}
    >
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
        {formatDate(value, intl.locale)}
      </Button>
    </CalendarPopover>
  )
}

interface CalendarPopoverProps {
  /** The trigger — rendered through `PopoverTrigger asChild`. */
  children: ReactElement
  selected: Date | undefined
  /** `undefined` when the selected day is clicked again (deselect). */
  onSelect: (d: Date | undefined) => void
  /** Days outside [min, max] cannot be picked. */
  min?: Date | undefined
  max?: Date | undefined
}

/**
 * The one Calendar-in-Popover every date field uses: a single-day calendar
 * stretched to the popover width, in the app's language. Closes on pick.
 */
export function CalendarPopover({
  children,
  selected,
  onSelect,
  min,
  max,
}: CalendarPopoverProps) {
  const intl = useIntl()
  const locale = CALENDAR_LOCALES[intl.locale] ?? enUS
  const [open, setOpen] = useState(false)
  const disabled = [
    ...(min ? [{ before: min }] : []),
    ...(max ? [{ after: max }] : []),
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-[320px] p-0' align='start'>
        <Calendar
          mode='single'
          // Match the DueDate picker: stretch the calendar (and its inner
          // table) to the popover width so the cells have breathing room
          // instead of collapsing to --cell-size.
          className='w-full [&_[data-slot=calendar]]:w-full'
          style={{ '--cell-size': '2.5rem' } as React.CSSProperties}
          selected={selected}
          {...(selected ? { defaultMonth: selected } : {})}
          {...(disabled.length > 0 ? { disabled } : {})}
          onSelect={d => {
            onSelect(d)
            setOpen(false)
          }}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  )
}
