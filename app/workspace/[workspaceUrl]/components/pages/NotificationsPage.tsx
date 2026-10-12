'use client'

import { useIntl } from 'react-intl'
import { Switch } from '@/components/ui/switch'
import { usePreferences } from '../../hooks/usePreferences'
import type { Preferences } from '../../hooks/usePreferences'

interface NotifyRow {
  labelId: string
  prefKey: keyof Preferences
}

const IN_APP_EVENTS: NotifyRow[] = [
  { labelId: 'notifications.taskAssigned', prefKey: 'notifyInAppAssigned' },
  { labelId: 'notifications.newComment', prefKey: 'notifyInAppComment' },
  { labelId: 'notifications.agentDone', prefKey: 'notifyInAppAgentDone' },
  { labelId: 'notifications.agentInput', prefKey: 'notifyInAppAgentInput' },
  { labelId: 'notifications.mentioned', prefKey: 'notifyInAppMention' },
]

// Only events that actually send a Slack DM get a Slack switch. Comment,
// agent-done and agent-input have no Slack sender (LUM-1098), so a switch for
// them would do nothing; their preference columns are kept, just not shown.
const SLACK_EVENTS: NotifyRow[] = [
  { labelId: 'notifications.taskAssigned', prefKey: 'notifySlackAssigned' },
  { labelId: 'notifications.mentioned', prefKey: 'notifySlackMention' },
]

interface ToggleSectionProps {
  title: string
  rows: NotifyRow[]
  prefs: Preferences
  loading: boolean
  onToggle: (key: keyof Preferences, value: boolean) => void
}

function ToggleSection({
  title,
  rows,
  prefs,
  loading,
  onToggle,
}: ToggleSectionProps) {
  const intl = useIntl()
  return (
    <section aria-label={title}>
      <h2 className='text-sm font-semibold text-foreground mb-2'>{title}</h2>
      <div className='border border-border rounded-lg overflow-hidden bg-card mb-6'>
        {rows.map((row, i) => (
          <div
            key={row.prefKey}
            className={`flex items-center justify-between px-4 py-3 ${i < rows.length - 1 ? 'border-b border-border' : ''}`}
          >
            <p className='text-sm text-foreground'>
              {intl.formatMessage({ id: row.labelId })}
            </p>
            <Switch
              checked={prefs[row.prefKey] as boolean}
              onCheckedChange={v => onToggle(row.prefKey, v)}
              disabled={loading}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

export function NotificationsPage() {
  const { prefs, loading, updatePreferences } = usePreferences()
  const intl = useIntl()
  const onToggle = (key: keyof Preferences, value: boolean) =>
    updatePreferences({ [key]: value })

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'notifications.title' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-8'>
          {intl.formatMessage({ id: 'notifications.subtitle' })}
        </p>

        <ToggleSection
          title={intl.formatMessage({ id: 'notifications.inApp' })}
          rows={IN_APP_EVENTS}
          prefs={prefs}
          loading={loading}
          onToggle={onToggle}
        />
        <ToggleSection
          title={intl.formatMessage({ id: 'notifications.slack' })}
          rows={SLACK_EVENTS}
          prefs={prefs}
          loading={loading}
          onToggle={onToggle}
        />
      </div>
    </div>
  )
}
