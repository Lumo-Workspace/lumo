'use client'

import { Switch } from '@/components/ui/switch'
import { usePreferences } from '../../hooks/usePreferences'
import type { Preferences } from '../../hooks/usePreferences'

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

export function NotificationsPage() {
  const { prefs, loading, updatePreferences } = usePreferences()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          Notifications
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Choose what you get notified about.
        </p>

        {/* In-App Notifications */}
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

        {/* Slack Notifications */}
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
