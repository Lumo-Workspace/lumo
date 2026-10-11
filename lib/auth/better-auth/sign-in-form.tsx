'use client'

/**
 * LUM-1027 — the self-hosted sign-in / sign-up page (Better Auth): one button
 * per OAuth provider the instance has configured, then email sign-in. The
 * options are read at runtime from GET /api/auth/lumo/config.
 *
 * LUM-1082 — email first, like the Clerk page: an email one-time code
 * (./email-code-sign-in) when the instance can send one; email + password
 * (./password-sign-in) when password sign-in is on — as the alternative to
 * the code, or alone when no code can be sent.
 */
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthClient } from './auth-client'
import type { SocialProviderId } from './config'
import {
  REDIRECT_PARAM_NAME,
  authErrorCode,
  errorMessageId,
  safeRedirectTarget,
  socialErrorCallbackUrl,
  socialErrorMessageId,
} from './sign-in-helpers'
import {
  emailCodeEnabledIn,
  passwordEnabledIn,
  usePublicAuthConfig,
} from './public-config'
import { SocialSignInButtons } from './social-sign-in-buttons'
import { EmailCodeSignIn, type EmailCodeStep } from './email-code-sign-in'
import { PasswordSignIn } from './password-sign-in'

type Mode = 'signIn' | 'signUp'
type Method = 'code' | 'password'

const linkButtonClass =
  'w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'

export function SignIn() {
  const intl = useIntl()
  const searchParams = useSearchParams()
  const config = usePublicAuthConfig()
  const [mode, setMode] = useState<Mode>('signIn')
  // null = the default for this instance (the code when it can be sent).
  const [chosenMethod, setChosenMethod] = useState<Method | null>(null)
  const [codeStep, setCodeStep] = useState<EmailCodeStep>('email')
  // A failed social sign-in comes back here with Better Auth's `?error=`.
  const [errorId, setErrorId] = useState<string | null>(() =>
    socialErrorMessageId(searchParams.get('error'))
  )

  const target = safeRedirectTarget(searchParams.get(REDIRECT_PARAM_NAME))
  const passwordEnabled = passwordEnabledIn(config)
  const emailCodeEnabled = emailCodeEnabledIn(config)
  const method: Method | null =
    config === undefined
      ? null // options still loading
      : emailCodeEnabled && (chosenMethod ?? 'code') === 'code'
        ? 'code'
        : passwordEnabled
          ? 'password'
          : null
  // Password sign-up: the code flow creates accounts by itself.
  const signUpEnabled = (config?.signUpEnabled ?? false) && passwordEnabled
  const isSignUp = method === 'password' && mode === 'signUp' && signUpEnabled
  const showSocial =
    !!config &&
    config.socialProviders.length > 0 &&
    !(method === 'code' && codeStep === 'code')

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

  const t = (id: string) => intl.formatMessage({ id })

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
        {showSocial && (
          <>
            <SocialSignInButtons
              providers={config?.socialProviders ?? []}
              onSelect={handleSocial}
            />
            {method && (
              <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                <span className='h-px flex-1 bg-border' />
                {t('auth.divider.or')}
                <span className='h-px flex-1 bg-border' />
              </div>
            )}
          </>
        )}
        {errorId && (
          <p role='alert' className='text-sm text-danger-text'>
            {t(errorId)}
          </p>
        )}
        {method === 'code' && (
          <EmailCodeSignIn target={target} onStepChange={setCodeStep} />
        )}
        {method === 'password' && (
          <PasswordSignIn
            key={isSignUp ? 'signUp' : 'signIn'}
            target={target}
            isSignUp={isSignUp}
          />
        )}
        {method === 'password' && signUpEnabled && (
          <button
            type='button'
            className={linkButtonClass}
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
        {emailCodeEnabled &&
          passwordEnabled &&
          !(method === 'code' && codeStep === 'code') && (
            <button
              type='button'
              className={linkButtonClass}
              onClick={() => {
                setErrorId(null)
                setMode('signIn')
                setCodeStep('email')
                setChosenMethod(method === 'code' ? 'password' : 'code')
              }}
            >
              {t(
                method === 'code'
                  ? 'auth.emailCode.usePassword'
                  : 'auth.emailCode.useCode'
              )}
            </button>
          )}
      </CardContent>
    </Card>
  )
}
