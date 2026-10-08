'use client'

/**
 * LUM-1044 — consent screen of the self-hosted MCP OAuth authorization
 * server (/oauth/consent). Shows which client asks, for which scopes, as
 * which signed-in user, and where the browser returns; Allow / Deny post the
 * decision (with the signed request, attached by the OAuth client plugin) to
 * /api/auth/oauth2/consent and follow the redirect it answers with.
 *
 * The page is behind the proxy's sign-in gate, and the consent endpoint
 * itself requires the session, so an anonymous visitor never decides.
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthClient } from './auth-client'
import { hardNavigate } from './navigate'
import {
  oauthRedirectUrl,
  parseConsentRequest,
  scopeMessageId,
} from './consent-helpers'

interface PublicClient {
  client_id: string
  client_name?: string
}

function useClientName(clientId: string | null): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    void (async () => {
      let label = clientId
      try {
        const { data } = await getAuthClient().$fetch<PublicClient>(
          '/oauth2/public-client',
          { method: 'GET', query: { client_id: clientId } }
        )
        label = data?.client_name?.trim() || clientId
      } catch {
        // Show the client id; the decision is still checked server-side.
      }
      if (!cancelled) setName(label)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])
  return name
}

export function OAuthConsent() {
  const intl = useIntl()
  const searchParams = useSearchParams()
  const request = parseConsentRequest(searchParams.toString())
  const clientName = useClientName(request?.clientId ?? null)
  const { data: session } = getAuthClient().useSession()
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id }, values)

  const decide = async (accept: boolean) => {
    setSubmitting(true)
    setFailed(false)
    try {
      const { data } = await getAuthClient().$fetch('/oauth2/consent', {
        method: 'POST',
        body: { accept },
      })
      const url = oauthRedirectUrl(data)
      if (url) {
        hardNavigate(url)
        return
      }
    } catch {
      // fall through to the error message
    }
    setFailed(true)
    setSubmitting(false)
  }

  if (!request) {
    return (
      <Card className='w-full max-w-md shadow-elevation-3'>
        <CardContent className='pt-6'>
          <p role='alert' className='text-sm text-danger-text'>
            {t('oauth.consent.invalid')}
          </p>
        </CardContent>
      </Card>
    )
  }

  const client = clientName ?? t('oauth.consent.loading')

  return (
    <Card className='w-full max-w-md shadow-elevation-3'>
      <CardHeader className='space-y-1'>
        <CardTitle className='text-lg font-semibold text-foreground'>
          {t('oauth.consent.title', { client })}
        </CardTitle>
        <p className='text-sm text-muted-foreground'>
          {t('oauth.consent.subtitle', { client })}
        </p>
        {session?.user.email && (
          <p className='text-xs text-muted-foreground'>
            {t('oauth.consent.signedInAs', { email: session.user.email })}
          </p>
        )}
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-2'>
          <p className='text-sm font-medium text-foreground'>
            {t('oauth.consent.scopesHeading')}
          </p>
          <ul className='space-y-1.5'>
            {request.scopes.map(scope => {
              const id = scopeMessageId(scope)
              return (
                <li
                  key={scope}
                  className='flex gap-2 text-sm text-foreground'
                  data-scope={scope}
                >
                  <span aria-hidden className='text-muted-foreground'>
                    •
                  </span>
                  <span>
                    {id ? t(id) : scope}{' '}
                    <code className='text-xs text-muted-foreground'>
                      {scope}
                    </code>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        <p className='text-xs text-muted-foreground'>
          {t('oauth.consent.redirectNotice', { host: request.redirectHost })}
        </p>
        {failed && (
          <p role='alert' className='text-sm text-danger-text'>
            {t('auth.error.generic')}
          </p>
        )}
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='outline'
            className='flex-1'
            disabled={submitting}
            onClick={() => decide(false)}
          >
            {t('oauth.consent.deny')}
          </Button>
          <Button
            type='button'
            className='flex-1'
            disabled={submitting || clientName === null}
            onClick={() => decide(true)}
          >
            {t('oauth.consent.allow')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
