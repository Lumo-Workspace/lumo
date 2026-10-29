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
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { SUPPORTED_LOCALES } from '@/lib/i18n/locales'
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
        active
          ? 'bg-muted text-body-strong text-foreground'
          : 'text-body text-muted-foreground hover:bg-muted'
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

export function PreferencesSettings() {
  const { prefs, loading, updatePreferences } = usePreferences()
  const intl = useIntl()

  const getTimezoneLabel = (tz: string) => formatTimezoneLabel(tz, intl)

  return (
    <div>
      {/* Appearance */}
      <div className='border border-border rounded-lg overflow-hidden bg-card'>
        {/* Theme row */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Sun size={14} className='text-muted-foreground' />
            <p className='text-body-strong text-foreground'>
              {intl.formatMessage({ id: 'preferences.theme' })}
            </p>
          </div>
          <div className='flex items-center gap-1 bg-muted rounded-lg p-0.5'>
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
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Globe size={14} className='text-muted-foreground' />
            <p className='text-body-strong text-foreground'>
              {intl.formatMessage({ id: 'preferences.language' })}
            </p>
          </div>
          <LanguageSwitcher
            value={prefs.locale}
            onChange={v =>
              updatePreferences({ locale: v as Preferences['locale'] })
            }
            options={SUPPORTED_LOCALES}
            disabled={loading}
          />
        </div>

        {/* Timezone row */}
        <div className='flex items-center justify-between px-4 py-3'>
          <div className='flex items-center gap-2'>
            <Clock size={14} className='text-muted-foreground' />
            <p className='text-body-strong text-foreground'>
              {intl.formatMessage({ id: 'preferences.timezone' })}
            </p>
          </div>
          <Select
            value={prefs.timezone}
            onValueChange={v => updatePreferences({ timezone: v })}
            disabled={loading}
          >
            <SelectTrigger className='w-48 h-8 text-body'>
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
  )
}
