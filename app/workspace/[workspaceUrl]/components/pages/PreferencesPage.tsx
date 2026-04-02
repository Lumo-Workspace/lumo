'use client'

import { Sun, Moon, Monitor, Globe, Clock } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences } from '../../hooks/usePreferences'
import type { Preferences } from '../../hooks/usePreferences'

const COMMON_TIMEZONES = [
  'auto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

function ThemeOption({
  value,
  current,
  icon: Icon,
  label,
  onSelect,
}: {
  value: Preferences['theme']
  current: Preferences['theme']
  icon: React.ElementType
  label: string
  onSelect: (v: Preferences['theme']) => void
}) {
  const active = value === current
  return (
    <button
      onClick={() => onSelect(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium'
          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

function formatTimezoneLabel(
  tz: string,
  intl: ReturnType<typeof useIntl>
): string {
  if (tz === 'auto') {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      return intl.formatMessage(
        { id: 'preferences.timezoneAuto' },
        { detected }
      )
    } catch {
      return intl.formatMessage({ id: 'preferences.timezoneAutoBrowser' })
    }
  }
  return tz.replace(/_/g, ' ')
}

export function PreferencesPage() {
  const { prefs, loading, updatePreferences } = usePreferences()
  const intl = useIntl()

  const getTimezoneLabel = (tz: string) => formatTimezoneLabel(tz, intl)

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'preferences.title' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'preferences.subtitle' })}
        </p>

        {/* Appearance */}
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900'>
          {/* Theme row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-2'>
              <Sun size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                {intl.formatMessage({ id: 'preferences.theme' })}
              </p>
            </div>
            <div className='flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5'>
              <ThemeOption
                value='light'
                current={prefs.theme}
                icon={Sun}
                label={intl.formatMessage({ id: 'preferences.themeLight' })}
                onSelect={v => updatePreferences({ theme: v })}
              />
              <ThemeOption
                value='dark'
                current={prefs.theme}
                icon={Moon}
                label={intl.formatMessage({ id: 'preferences.themeDark' })}
                onSelect={v => updatePreferences({ theme: v })}
              />
              <ThemeOption
                value='system'
                current={prefs.theme}
                icon={Monitor}
                label={intl.formatMessage({ id: 'preferences.themeSystem' })}
                onSelect={v => updatePreferences({ theme: v })}
              />
            </div>
          </div>

          {/* Language row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-2'>
              <Globe size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                {intl.formatMessage({ id: 'preferences.language' })}
              </p>
            </div>
            <Select
              value={prefs.locale}
              onValueChange={v =>
                updatePreferences({ locale: v as Preferences['locale'] })
              }
              disabled={loading}
            >
              <SelectTrigger className='w-32 h-8 text-sm'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='en'>English</SelectItem>
                <SelectItem value='zh'>中文</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Timezone row */}
          <div className='flex items-center justify-between px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Clock size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                {intl.formatMessage({ id: 'preferences.timezone' })}
              </p>
            </div>
            <Select
              value={prefs.timezone}
              onValueChange={v => updatePreferences({ timezone: v })}
              disabled={loading}
            >
              <SelectTrigger className='w-48 h-8 text-sm'>
                <SelectValue>{getTimezoneLabel(prefs.timezone)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map(tz => (
                  <SelectItem key={tz} value={tz}>
                    {getTimezoneLabel(tz)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}
