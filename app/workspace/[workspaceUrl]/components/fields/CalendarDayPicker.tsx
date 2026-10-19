'use client'

import type { ReactElement } from 'react'
import { CalendarDays } from 'lucide-react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCalendarDate } from '@/lib/datetime/format'
import {
  dayKeyToLocalDate,
  localDateToDayKey,
} from '@/lib/datetime/calendar-day'
import { CalendarPopover } from './DatePickerField'

interface CalendarDayPopoverProps {
  /** The trigger — any focusable element (rendered via `asChild`). */
  children: ReactElement
  /** `YYYY-MM-DD` (a full ISO string is accepted), or '' for none. */
  value: string
  /** Receives a `YYYY-MM-DD` key, or '' when the picked day is cleared. */
  onChange: (value: string) => void
  /** Clicking the selected day again clears the field. */
  clearable?: boolean
  min?: string | undefined
  max?: string | undefined
}

/**
 * Calendar-day picker with a caller-supplied trigger. Values are calendar
 * days (`YYYY-MM-DD`), converted through local components so a day picked
 * in any zone saves as that same day.
 */
export function CalendarDayPopover({
  children,
  value,
  onChange,
  clearable = false,
  min,
  max,
}: CalendarDayPopoverProps) {
  return (
    <CalendarPopover
      selected={dayKeyToLocalDate(value)}
      min={dayKeyToLocalDate(min)}
      max={dayKeyToLocalDate(max)}
      onSelect={d => {
        if (d) onChange(localDateToDayKey(d))
        else if (clearable) onChange('')
      }}
    >
      {children}
    </CalendarPopover>
  )
}

interface CalendarDayPickerProps extends Omit<
  CalendarDayPopoverProps,
  'children'
> {
  id?: string
  /** Shown when there is no value. */
  placeholder: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** The form-field variant: an outline button showing the day. */
export function CalendarDayPicker({
  id,
  placeholder,
  disabled,
  className,
  'aria-label': ariaLabel,
  ...popover
}: CalendarDayPickerProps) {
  const intl = useIntl()
  return (
    <CalendarDayPopover {...popover}>
      <Button
        id={id}
        type='button'
        variant='outline'
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'w-full justify-start text-left font-normal',
          !popover.value && 'text-muted-foreground',
          className
        )}
      >
        <CalendarDays className='size-4' />
        {popover.value
          ? formatCalendarDate(popover.value.slice(0, 10), intl.locale)
          : placeholder}
      </Button>
    </CalendarDayPopover>
  )
}
