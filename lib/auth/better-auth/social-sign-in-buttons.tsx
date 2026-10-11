'use client'

/**
 * LUM-1082 — "Continue with Google / GitHub" buttons of the Better Auth
 * sign-in page, each with the provider's mark (as on the Clerk page).
 */
import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/components/ui/icons'
import { GithubIcon } from '@/components/icons/GithubIcon'
import type { SocialProviderId } from './config'

const PROVIDER_LABELS: Record<SocialProviderId, string> = {
  github: 'GitHub',
  google: 'Google',
}

const PROVIDER_ICONS: Record<SocialProviderId, ReactNode> = {
  github: <GithubIcon size={16} className='h-4 w-4' />,
  google: <GoogleIcon className='h-4 w-4' />,
}

export function SocialSignInButtons({
  providers,
  onSelect,
}: {
  providers: readonly SocialProviderId[]
  onSelect: (provider: SocialProviderId) => void
}) {
  const intl = useIntl()
  return (
    <div className='space-y-2'>
      {providers.map(provider => (
        <Button
          key={provider}
          type='button'
          variant='outline'
          className='w-full gap-2'
          onClick={() => onSelect(provider)}
        >
          <span data-testid={`social-icon-${provider}`} className='flex'>
            {PROVIDER_ICONS[provider]}
          </span>
          {intl.formatMessage(
            { id: 'auth.oauth.continueWith' },
            { provider: PROVIDER_LABELS[provider] }
          )}
        </Button>
      ))}
    </div>
  )
}
