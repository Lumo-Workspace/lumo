'use client'

import { Sun, Moon, Monitor, Globe, Clock } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
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

function getTimezoneLabel(tz: string): string {
  if (tz === 'auto') {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      return `Auto (${detected})`
    } catch {
      return 'Auto (browser)'
    }
  }
  return tz.replace(/_/g, ' ')
}

interface NotifyRow {
  label: string
  inAppKey: keyof Preferences
  slackKey: keyof Preferences
}

const NOTIFY_EVENTS: NotifyRow[] = [
  {
    label: 'Task assigned to me',
    inAppKey: 'notifyInAppAssigned',
    slackKey: 'notifySlackAssigned',
  },
  {
    label: 'New comment on my tasks',
    inAppKey: 'notifyInAppComment',
    slackKey: 'notifySlackComment',
  },
  {
    label: 'Agent completed / needs review',
    inAppKey: 'notifyInAppAgentDone',
    slackKey: 'notifySlackAgentDone',
  },
  {
    label: 'Agent waiting for input',
    inAppKey: 'notifyInAppAgentInput',
    slackKey: 'notifySlackAgentInput',
  },
  {
    label: 'Mentioned in a comment',
    inAppKey: 'notifyInAppMention',
    slackKey: 'notifySlackMention',
  },
]

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

export function PreferencesPage() {
  const { prefs, loading, updatePreferences } = usePreferences()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          Preferences
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Customize your experience.
        </p>

        {/* Card 1: Appearance */}
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 mb-6'>
          {/* Theme row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-2'>
              <Sun size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                Theme
              </p>
            </div>
            <div className='flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5'>
              <ThemeOption
                value='light'
                current={prefs.theme}
                icon={Sun}
                label='Light'
                onSelect={v => updatePreferences({ theme: v })}
              />
              <ThemeOption
                value='dark'
                current={prefs.theme}
                icon={Moon}
                label='Dark'
                onSelect={v => updatePreferences({ theme: v })}
              />
              <ThemeOption
                value='system'
                current={prefs.theme}
                icon={Monitor}
                label='System'
                onSelect={v => updatePreferences({ theme: v })}
              />
            </div>
          </div>

          {/* Language row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-2'>
              <Globe size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                Language
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
                Timezone
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

        {/* Card 2: In-App Notifications */}
        <h2 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2'>
          In-App Notifications
        </h2>
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 mb-6'>
          {NOTIFY_EVENTS.map((evt, i) => (
            <div
              key={evt.inAppKey}
              className={`flex items-center justify-between px-4 py-3 ${i < NOTIFY_EVENTS.length - 1 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''}`}
            >
              <p className='text-sm text-zinc-700 dark:text-zinc-300'>
                {evt.label}
              </p>
              <Switch
                checked={prefs[evt.inAppKey] as boolean}
                onCheckedChange={v => updatePreferences({ [evt.inAppKey]: v })}
                disabled={loading}
              />
            </div>
          ))}
        </div>

        {/* Card 3: Slack Notifications */}
        <h2 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2'>
          Slack Notifications
        </h2>
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900'>
          {NOTIFY_EVENTS.map((evt, i) => (
            <div
              key={evt.slackKey}
              className={`flex items-center justify-between px-4 py-3 ${i < NOTIFY_EVENTS.length - 1 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''}`}
            >
              <p className='text-sm text-zinc-700 dark:text-zinc-300'>
                {evt.label}
              </p>
              <Switch
                checked={prefs[evt.slackKey] as boolean}
                onCheckedChange={v => updatePreferences({ [evt.slackKey]: v })}
                disabled={loading}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
