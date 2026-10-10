'use client'

/**
 * LUM-1027 — the self-hosted sign-in / sign-up form (Better Auth): email +
 * password, plus one button per OAuth provider the instance has configured
 * (read at runtime from GET /api/auth/lumo/config).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getAuthClient } from './auth-client'
import { hardNavigate } from './navigate'
import type { PublicAuthConfig, SocialProviderId } from './config'
import {
  MIN_PASSWORD_LENGTH,
  REDIRECT_PARAM_NAME,
  RESET_PASSWORD_PATH,
  authErrorCode,
  errorMessageId,
  safeRedirectTarget,
  socialErrorCallbackUrl,
  socialErrorMessageId,
} from './sign-in-helpers'
import { oauthRedirectUrl } from './consent-helpers'

type Mode = 'signIn' | 'signUp'

const PROVIDER_LABELS: Record<SocialProviderId, string> = {
  github: 'GitHub',
  google: 'Google',
}

function usePublicAuthConfig(): PublicAuthConfig | null {
  const [config, setConfig] = useState<PublicAuthConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await getAuthClient().$fetch<PublicAuthConfig>(
        '/lumo/config',
        { method: 'GET' }
      )
      if (!cancelled && data) setConfig(data)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return config
}

export function SignIn() {
  const intl = useIntl()
  const searchParams = useSearchParams()
  const config = usePublicAuthConfig()
  const [mode, setMode] = useState<Mode>('signIn')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // A failed social sign-in comes back here with Better Auth's `?error=`.
  const [errorId, setErrorId] = useState<string | null>(() =>
    socialErrorMessageId(searchParams.get('error'))
  )

  const target = safeRedirectTarget(searchParams.get(REDIRECT_PARAM_NAME))
  const signUpEnabled = config?.signUpEnabled ?? false
  const isSignUp = mode === 'signUp' && signUpEnabled

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setErrorId(null)
    const authClient = getAuthClient()
    let code: string | null = null
    // Set when this sign-in continues an MCP client's OAuth authorization
    // (LUM-1044): the server answers with the consent page or the client.
    let continueTo: string | null = null
    try {
      const { data, error } = isSignUp
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
          })
        : await authClient.signIn.email({ email: email.trim(), password })
      code = error ? authErrorCode(error) : null
      continueTo = oauthRedirectUrl(data)
    } catch {
      code = '' // network failure → generic message
    }
    if (code !== null) {
      setErrorId(errorMessageId(code))
      setSubmitting(false)
      return
    }
    // Full navigation so server components see the new session cookie.
    hardNavigate(continueTo ?? target)
  }

  const handleSocial = async (provider: SocialProviderId) => {
    setErrorId(null)
    try {
      const { error } = await getAuthClient().signIn.social({
        provider,
        callbackURL: target,
        errorCallbackURL: socialErrorCallbackUrl(target),
      })
      if (error) setErrorId(errorMessageId(authErrorCode(error)))
    } catch {
      setErrorId(errorMessageId(null))
    }
  }

  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id }, values)

  return (
    <Card className='w-full max-w-md shadow-elevation-3'>
      <CardHeader className='text-center space-y-6'>
        <div className='flex justify-center'>
          <Image
            src='/logo-dark.svg'
            alt={t('onboarding.logoAlt')}
            width={48}
            height={48}
            className='h-12 w-12'
            priority
          />
        </div>
        <div className='space-y-1'>
          <CardTitle className='text-lg font-semibold text-foreground'>
            {t(isSignUp ? 'auth.signUp.title' : 'auth.signIn.title')}
          </CardTitle>
          <p className='text-sm text-muted-foreground'>
            {t(isSignUp ? 'auth.signUp.subtitle' : 'auth.signIn.subtitle')}
          </p>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {config && config.socialProviders.length > 0 && (
          <>
            <div className='space-y-2'>
              {config.socialProviders.map(provider => (
                <Button
                  key={provider}
                  type='button'
                  variant='outline'
                  className='w-full'
                  onClick={() => handleSocial(provider)}
                >
                  {t('auth.oauth.continueWith', {
                    provider: PROVIDER_LABELS[provider],
                  })}
                </Button>
              ))}
            </div>
            <div className='flex items-center gap-3 text-xs text-muted-foreground'>
              <span className='h-px flex-1 bg-border' />
              {t('auth.divider.or')}
              <span className='h-px flex-1 bg-border' />
            </div>
          </>
        )}
        <form onSubmit={handleSubmit} className='space-y-4'>
          {isSignUp && (
            <div className='space-y-1.5'>
              <Label
                htmlFor='auth-name'
                className='text-xs text-muted-foreground'
              >
                {t('auth.field.name')}
              </Label>
              <Input
                id='auth-name'
                autoComplete='name'
                required
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}
          <div className='space-y-1.5'>
            <Label
              htmlFor='auth-email'
              className='text-xs text-muted-foreground'
            >
              {t('auth.field.email')}
            </Label>
            <Input
              id='auth-email'
              type='email'
              autoComplete='email'
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className='space-y-1.5'>
            <Label
              htmlFor='auth-password'
              className='text-xs text-muted-foreground'
            >
              {t('auth.field.password')}
            </Label>
            <Input
              id='auth-password'
              type='password'
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={submitting}
            />
            {isSignUp ? (
              <p className='text-xs text-muted-foreground'>
                {t('auth.password.hint')}
              </p>
            ) : (
              <Link
                href={RESET_PASSWORD_PATH}
                className='block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
              >
                {t('auth.signIn.forgotPassword')}
              </Link>
            )}
          </div>
          {errorId && (
            <p role='alert' className='text-sm text-danger-text'>
              {t(errorId)}
            </p>
          )}
          <Button type='submit' disabled={submitting} className='w-full'>
            {submitting
              ? t('auth.submitting')
              : t(isSignUp ? 'auth.signUp.submit' : 'auth.signIn.submit')}
          </Button>
        </form>
        {signUpEnabled && (
          <button
            type='button'
            className='w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
            onClick={() => {
              setErrorId(null)
              setMode(isSignUp ? 'signIn' : 'signUp')
            }}
          >
            {t(
              isSignUp
                ? 'auth.signUp.switchToSignIn'
                : 'auth.signIn.switchToSignUp'
            )}
          </button>
        )}
      </CardContent>
    </Card>
  )
}
