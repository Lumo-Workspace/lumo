'use client'

import { useState } from 'react'
import {
  enUS,
  enGB,
  enAU,
  zhCN,
  zhTW,
  es,
  fr,
  de,
  ja,
  ko,
  hi,
  ru,
  vi,
  id,
  ms,
} from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { CalendarDays, X } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIntl } from 'react-intl'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatDueDate, isOverdue } from '../../utils'
import { cn } from '@/lib/utils'
import { useNow } from '@/hooks/use-now'

export interface DueDatePickerProps {
  value: string | null
  onChange: (v: string | null) => void
  triggerClassName?: string
}

export function DueDatePicker({
  value,
  onChange,
  triggerClassName,
}: DueDatePickerProps) {
  const intl = useIntl()
  const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
    en: enUS,
    'en-GB': enGB,
    'en-AU': enAU,
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'es-ES': es,
    'es-419': es,
    fr,
    de,
    ja,
    ko,
    hi,
    ru,
    vi,
    id,
    ms,
  }
  const calendarLocale = DATE_FNS_LOCALES[intl.locale] ?? enUS
  const now = useNow()
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogDate, setDialogDate] = useState<Date | undefined>(undefined)
  // Lazy initializer: read the clock once on mount, not on every render.
  const [dialogMonth, setDialogMonth] = useState<Date>(() => new Date())
  const [dateInput, setDateInput] = useState('')

  const overdue = isOverdue(value)
  const displayText = formatDueDate(value)

  function toDateOnly(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function pickDate(date: Date) {
    onChange(toDateOnly(date).toISOString())
    setOpen(false)
  }

  function computeQuickDate(
    offset: 'today' | 'tomorrow' | 'endOfWeek' | 'inOneWeek',
    now: number
  ): Date {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    switch (offset) {
      case 'today':
        break
      case 'tomorrow':
        d.setDate(d.getDate() + 1)
        break
      case 'endOfWeek': {
        const day = d.getDay() // 0=Sun
        const diff = day === 0 ? 5 : 5 - day // nearest Friday
        d.setDate(d.getDate() + (diff <= 0 ? 7 + diff : diff))
        break
      }
      case 'inOneWeek':
        d.setDate(d.getDate() + 7)
        break
    }
    return d
  }

  function formatShortDate(d: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`
  }

  function formatDateInput(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${mm}/${dd}/${d.getFullYear()}`
  }

  function parseDateInput(s: string): Date | null {
    const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!match) return null
    const [, mm, dd, yyyy] = match
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    if (isNaN(d.getTime())) return null
    return d
  }

  function openDialog() {
    setOpen(false)
    const initial = value ? new Date(value) : new Date()
    setDialogDate(initial)
    setDialogMonth(new Date(initial.getFullYear(), initial.getMonth(), 1))
    setDateInput(formatDateInput(initial))
    setDialogOpen(true)
  }

  function handleDialogSave() {
    if (dialogDate) {
      onChange(toDateOnly(dialogDate).toISOString())
    }
    setDialogOpen(false)
  }

  function handleDialogRemove() {
    onChange(null)
    setDialogOpen(false)
  }

  function handleDateInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setDateInput(val)
    const parsed = parseDateInput(val)
    if (parsed) {
      setDialogDate(parsed)
      setDialogMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    }
  }

  function setDialogPreset(daysFromNow: number) {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    d.setHours(0, 0, 0, 0)
    setDialogDate(d)
    setDialogMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    setDateInput(formatDateInput(d))
  }

  // Days-from-today for a quick preset. Reads the clock, so call it only from
  // event handlers (e.g. onClick) — never during render.
  function quickPresetDays(
    offset: 'today' | 'tomorrow' | 'endOfWeek' | 'inOneWeek'
  ): number {
    switch (offset) {
      case 'today':
        return 0
      case 'tomorrow':
        return 1
      case 'inOneWeek':
        return 7
      case 'endOfWeek': {
        const day = new Date().getDay() // 0=Sun
        const diff = day === 0 ? 5 : 5 - day // nearest Friday
        return diff <= 0 ? 7 + diff : diff
      }
    }
  }

  const quickOptions = [
    { key: 'today' as const, msgId: 'dueDate.today' },
    { key: 'tomorrow' as const, msgId: 'dueDate.tomorrow' },
    { key: 'endOfWeek' as const, msgId: 'dueDate.endOfWeek' },
    { key: 'inOneWeek' as const, msgId: 'dueDate.inOneWeek' },
  ]

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={cn(
                  triggerClassName,
                  'inline-flex items-center gap-1.5',
                  overdue && 'text-danger-text'
                )}
              >
                <CalendarDays className='size-3.5 shrink-0' />
                {displayText && <span>{displayText}</span>}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({ id: 'dueDate.label' })}
          </TooltipContent>
        </Tooltip>
        <PopoverContent className='w-auto p-0' align='start'>
          <div className='flex flex-col py-1'>
            {value && (
              <>
                <button
                  type='button'
                  className='flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors'
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <X className='size-3' />
                  {intl.formatMessage({ id: 'dueDate.removeDueDate' })}
                </button>
                <div className='border-b border-border my-0.5' />
              </>
            )}
            <button
              type='button'
              className='flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted transition-colors'
              onClick={openDialog}
            >
              <span className='flex items-center gap-2'>
                <CalendarDays className='size-3' />
                {intl.formatMessage({ id: 'dueDate.custom' })}
              </span>
            </button>
            <div className='border-b border-border my-0.5' />
            {now != null &&
              quickOptions.map(({ key, msgId }) => {
                const d = computeQuickDate(key, now)
                return (
                  <button
                    key={key}
                    type='button'
                    className='flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted transition-colors'
                    onClick={() => pickDate(d)}
                  >
                    <span>{intl.formatMessage({ id: msgId })}</span>
                    <span className='text-muted-foreground ml-4'>
                      {formatShortDate(d)}
                    </span>
                  </button>
                )
              })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Custom date picker dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-w-xs'>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'dueDate.editTitle' })}
            </DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: 'dueDate.editDescription' })}
            </DialogDescription>
          </DialogHeader>
          <div>
            <input
              type='text'
              value={dateInput}
              onChange={handleDateInputChange}
              placeholder='MM/DD/YYYY'
              className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
            />
          </div>
          <div>
            <Calendar
              mode='single'
              className='w-full [&_[data-slot=calendar]]:w-full'
              style={{ '--cell-size': '2.25rem' } as React.CSSProperties}
              selected={dialogDate}
              onSelect={day => {
                if (day) {
                  setDialogDate(day)
                  setDialogMonth(new Date(day.getFullYear(), day.getMonth(), 1))
                  setDateInput(formatDateInput(day))
                }
              }}
              month={dialogMonth}
              onMonthChange={setDialogMonth}
              locale={calendarLocale}
              fixedWeeks
            />
          </div>
          <div className='flex flex-wrap gap-2 border-t border-border pt-3'>
            {quickOptions.map(({ key, msgId }) => (
              <Button
                key={key}
                variant='outline'
                size='sm'
                className='flex-1'
                onClick={() => setDialogPreset(quickPresetDays(key))}
              >
                {intl.formatMessage({ id: msgId })}
              </Button>
            ))}
          </div>
          <DialogFooter className='sm:justify-between'>
            <Button
              variant='ghost'
              size='sm'
              className=''
              onClick={handleDialogRemove}
            >
              {intl.formatMessage({ id: 'dueDate.removeDueDate' })}
            </Button>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setDialogOpen(false)}
              >
                {intl.formatMessage({ id: 'dueDate.cancel' })}
              </Button>
              <Button size='sm' onClick={handleDialogSave}>
                {intl.formatMessage({ id: 'dueDate.save' })}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
