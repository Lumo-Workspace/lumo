'use client'

import { useIntl } from 'react-intl'
import { SettingsSection } from '../settings/SettingsSection'
import { SettingsPageLayout } from '../settings/SettingsPageLayout'
import { ProfileSettings } from './ProfileSettings'
import { PreferencesSettings } from './PreferencesSettings'
import { CliSetupSteps } from './CliSetupSteps'
import { ApiKeysSettings } from './ApiKeysSettings'

/**
 * LUM-1339 — Personal → Account: the old Profile and Preferences pages
 * (seven fields between them) on one page.
 */
export function AccountSettingsPage() {
  const intl = useIntl()
  return (
    <SettingsPageLayout
      title={intl.formatMessage({ id: 'settings.account' })}
      subtitle={intl.formatMessage({ id: 'settings.account.subtitle' })}
    >
      <SettingsSection
        id='profile'
        title={intl.formatMessage({ id: 'profile.title' })}
      >
        <ProfileSettings />
      </SettingsSection>
      <SettingsSection
        id='preferences'
        title={intl.formatMessage({ id: 'preferences.title' })}
      >
        <PreferencesSettings />
      </SettingsSection>
    </SettingsPageLayout>
  )
}

/**
 * LUM-1339 — Personal → CLI & API keys: setting up the CLI needs a key, so
 * the steps and the key list share a page.
 */
export function DeveloperSettingsPage() {
  const intl = useIntl()
  return (
    <SettingsPageLayout
      title={intl.formatMessage({ id: 'settings.developer' })}
      subtitle={intl.formatMessage({ id: 'cli.subtitle' })}
    >
      <SettingsSection
        id='cli'
        title={intl.formatMessage({ id: 'settings.cli' })}
      >
        <CliSetupSteps />
      </SettingsSection>
      <SettingsSection
        id='api-keys'
        title={intl.formatMessage({ id: 'apiKeys.title' })}
      >
        <p className='text-body text-muted-foreground mb-4'>
          {intl.formatMessage({ id: 'apiKeys.subtitle' })}
        </p>
        <ApiKeysSettings />
      </SettingsSection>
    </SettingsPageLayout>
  )
}
