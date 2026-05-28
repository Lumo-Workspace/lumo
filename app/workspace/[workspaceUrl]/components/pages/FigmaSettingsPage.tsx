'use client'

import { FigmaIntegrationCard } from '../FigmaIntegrationCard'
import { useIntl } from 'react-intl'

export function FigmaSettingsPage({ isOwner: _isOwner }: { isOwner: boolean }) {
  const intl = useIntl()

  return (
    <div className='flex-1 overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'figma.settingsTitle' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'figma.settingsDescription' })}
        </p>
        <FigmaIntegrationCard />
      </div>
    </div>
  )
}
