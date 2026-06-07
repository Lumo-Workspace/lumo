'use client'

import { useIntl } from 'react-intl'
import { Switch } from '@/components/ui/switch'
import { usePreferences } from '../../hooks/usePreferences'
import type { Preferences } from '../../hooks/usePreferences'

interface NotifyRow {
  labelId: string
  inAppKey: keyof Preferences
  slackKey: keyof Preferences
}

const NOTIFY_EVENTS: NotifyRow[] = [
  {
    labelId: 'notifications.taskAssigned',
    inAppKey: 'notifyInAppAssigned',
    slackKey: 'notifySlackAssigned',
  },
  {
    labelId: 'notifications.newComment',
    inAppKey: 'notifyInAppComment',
    slackKey: 'notifySlackComment',
  },
  {
    labelId: 'notifications.agentDone',
    inAppKey: 'notifyInAppAgentDone',
    slackKey: 'notifySlackAgentDone',
  },
  {
    labelId: 'notifications.agentInput',
    inAppKey: 'notifyInAppAgentInput',
    slackKey: 'notifySlackAgentInput',
  },
  {
    labelId: 'notifications.mentioned',
    inAppKey: 'notifyInAppMention',
    slackKey: 'notifySlackMention',
  },
]

export function NotificationsPage() {
  const { prefs, loading, updatePreferences } = usePreferences()
  const intl = useIntl()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'notifications.title' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-8'>
          {intl.formatMessage({ id: 'notifications.subtitle' })}
        </p>

        {/* In-App Notifications */}
        <h2 className='text-sm font-semibold text-foreground mb-2'>
          {intl.formatMessage({ id: 'notifications.inApp' })}
        </h2>
        <div className='border border-border rounded-lg overflow-hidden bg-card mb-6'>
          {NOTIFY_EVENTS.map((evt, i) => (
            <div
              key={evt.inAppKey}
              className={`flex items-center justify-between px-4 py-3 ${i < NOTIFY_EVENTS.length - 1 ? 'border-b border-border' : ''}`}
            >
              <p className='text-sm text-foreground'>
                {intl.formatMessage({ id: evt.labelId })}
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
        <h2 className='text-sm font-semibold text-foreground mb-2'>
          {intl.formatMessage({ id: 'notifications.slack' })}
        </h2>
        <div className='border border-border rounded-lg overflow-hidden bg-card'>
          {NOTIFY_EVENTS.map((evt, i) => (
            <div
              key={evt.slackKey}
              className={`flex items-center justify-between px-4 py-3 ${i < NOTIFY_EVENTS.length - 1 ? 'border-b border-border' : ''}`}
            >
              <p className='text-sm text-foreground'>
                {intl.formatMessage({ id: evt.labelId })}
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
