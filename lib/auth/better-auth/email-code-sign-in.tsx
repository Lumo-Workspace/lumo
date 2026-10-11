'use client'

/**
 * LUM-1082 — email-first, one-time-code sign-in (Better Auth emailOTP, see
 * ./email-otp): enter your email → "Continue" sends a 6-digit code → enter it.
 * The same two steps create the account for a new email (unless sign-up is
 * off). The send answers the same whether or not the account exists, so the
 * form always moves on to the code step.
 */
import { useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getAuthClient } from './auth-client'
import { hardNavigate } from './navigate'
import { oauthRedirectUrl } from './consent-helpers'
import {
  EMAIL_CODE_LENGTH,
  authErrorCode,
  errorMessageId,
  normalizeEmailCode,
} from './sign-in-helpers'

export type EmailCodeStep = 'email' | 'code'

/** Sends a sign-in code; the error message id, or null on success. */
async function sendCode(email: string): Promise<string | null> {
  try {
    const { error } = await getAuthClient().emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    })
    return error ? errorMessageId(authErrorCode(error)) : null
  } catch {
    return errorMessageId(null)
  }
}

export function EmailCodeSignIn({
  target,
  onStepChange,
}: {
  /** Where to go after signing in (already validated). */
  target: string
  onStepChange?: (step: EmailCodeStep) => void
}) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id }, values)
  const [step, setStep] = useState<EmailCodeStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  const goTo = (next: EmailCodeStep) => {
    setStep(next)
    onStepChange?.(next)
  }

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setErrorId(null)
    const failure = await sendCode(email.trim())
    setSubmitting(false)
    if (failure) {
      setErrorId(failure)
      return
    }
    setCode('')
    setResent(false)
    goTo('code')
  }

  const handleResend = async () => {
    setSubmitting(true)
    setErrorId(null)
    setResent(false)
    const failure = await sendCode(email.trim())
    setSubmitting(false)
    if (failure) setErrorId(failure)
    else setResent(true)
  }

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setErrorId(null)
    setResent(false)
    let failure: string | null = null
    // Set when this sign-in continues an MCP client's OAuth authorization
    // (LUM-1044): the server answers with the consent page or the client.
    let continueTo: string | null = null
    try {
      const { data, error } = await getAuthClient().signIn.emailOtp({
        email: email.trim(),
        otp: code,
      })
      failure = error ? errorMessageId(authErrorCode(error)) : null
      continueTo = oauthRedirectUrl(data)
    } catch {
      failure = errorMessageId(null)
    }
    if (failure) {
      setErrorId(failure)
      setSubmitting(false)
      return
    }
    // Full navigation so server components see the new session cookie.
    hardNavigate(continueTo ?? target)
  }

  const error = errorId && (
    <p role='alert' className='text-sm text-danger-text'>
      {t(errorId)}
    </p>
  )

  if (step === 'email') {
    return (
      <form onSubmit={handleSend} className='space-y-4'>
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
        {error}
        <Button type='submit' disabled={submitting} className='w-full'>
          {submitting ? t('auth.submitting') : t('auth.emailCode.continue')}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleVerify} className='space-y-4'>
      <p className='text-sm text-muted-foreground'>
        {t('auth.emailCode.sentTo', { email: email.trim() })}
      </p>
      <div className='space-y-1.5'>
        <Label htmlFor='auth-code' className='text-xs text-muted-foreground'>
          {t('auth.field.code')}
        </Label>
        <Input
          id='auth-code'
          inputMode='numeric'
          autoComplete='one-time-code'
          pattern={`[0-9]{${EMAIL_CODE_LENGTH}}`}
          maxLength={EMAIL_CODE_LENGTH}
          required
          autoFocus
          value={code}
          onChange={e => setCode(normalizeEmailCode(e.target.value))}
          disabled={submitting}
          className='text-center tracking-[0.5em]'
        />
      </div>
      {error}
      {resent && !errorId && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('auth.emailCode.resent')}
        </p>
      )}
      <Button
        type='submit'
        disabled={submitting || code.length !== EMAIL_CODE_LENGTH}
        className='w-full'
      >
        {submitting ? t('auth.submitting') : t('auth.emailCode.verify')}
      </Button>
      <div className='flex items-center justify-between text-sm'>
        <button
          type='button'
          disabled={submitting}
          className='text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
          onClick={handleResend}
        >
          {t('auth.emailCode.resend')}
        </button>
        <button
          type='button'
          disabled={submitting}
          className='text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
          onClick={() => {
            setErrorId(null)
            setResent(false)
            goTo('email')
          }}
        >
          {t('auth.emailCode.changeEmail')}
        </button>
      </div>
    </form>
  )
}
