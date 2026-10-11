'use client'

/**
 * LUM-1027 — email + password sign-in / sign-up of the Better Auth sign-in
 * page. LUM-1082: only rendered when the instance keeps password sign-in on
 * (AUTH_DISABLE_PASSWORD unset).
 */
import { useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getAuthClient } from './auth-client'
import { hardNavigate } from './navigate'
import { oauthRedirectUrl } from './consent-helpers'
import {
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_PATH,
  authErrorCode,
  errorMessageId,
} from './sign-in-helpers'

export function PasswordSignIn({
  target,
  isSignUp,
}: {
  /** Where to go after signing in (already validated). */
  target: string
  /** Create an account instead of signing in. */
  isSignUp: boolean
}) {
  const intl = useIntl()
  const t = (id: string) => intl.formatMessage({ id })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorId, setErrorId] = useState<string | null>(null)

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

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      {isSignUp && (
        <div className='space-y-1.5'>
          <Label htmlFor='auth-name' className='text-xs text-muted-foreground'>
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
        <Label htmlFor='auth-email' className='text-xs text-muted-foreground'>
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
  )
}
