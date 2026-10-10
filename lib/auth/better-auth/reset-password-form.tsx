'use client'

/**
 * LUM-1070 — forgot / reset password (Better Auth), mounted on
 * /reset-password. Without a token it asks for the account email and sends a
 * reset link; the link brings the user back with `?token=…` to choose a new
 * password (or `?error=INVALID_TOKEN` when it is unknown or expired). The
 * server-side half is ./password-reset.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getAuthClient } from './auth-client'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_PATH,
  SIGN_IN_PAGE_PATH,
  authErrorCode,
  errorMessageId,
} from './sign-in-helpers'

type Translate = (id: string) => string

function useTranslate(): Translate {
  const intl = useIntl()
  return id => intl.formatMessage({ id })
}

function ResetCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <Card className='w-full max-w-md shadow-elevation-3'>
      <CardHeader className='text-center space-y-1'>
        <CardTitle className='text-lg font-semibold text-foreground'>
          {title}
        </CardTitle>
        <p className='text-sm text-muted-foreground'>{subtitle}</p>
      </CardHeader>
      <CardContent className='space-y-4'>{children}</CardContent>
    </Card>
  )
}

function BackToSignIn({ t }: { t: Translate }) {
  return (
    <Link
      href={SIGN_IN_PAGE_PATH}
      className='block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
    >
      {t('auth.resetPassword.backToSignIn')}
    </Link>
  )
}

function ErrorLine({ id, t }: { id: string | null; t: Translate }) {
  if (!id) return null
  return (
    <p role='alert' className='text-sm text-danger-text'>
      {t(id)}
    </p>
  )
}

/** Step 1: ask for the account email and send the reset link. */
function RequestResetLink({
  initialErrorId,
}: {
  initialErrorId: string | null
}) {
  const t = useTranslate()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorId, setErrorId] = useState<string | null>(initialErrorId)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setErrorId(null)
    try {
      const { error } = await getAuthClient().requestPasswordReset({
        email: email.trim(),
        redirectTo: RESET_PASSWORD_PATH,
      })
      if (error) setErrorId(errorMessageId(authErrorCode(error)))
      else setSent(true)
    } catch {
      setErrorId(errorMessageId(null))
    }
    setSubmitting(false)
  }

  return (
    <ResetCard
      title={t('auth.resetPassword.request.title')}
      subtitle={t('auth.resetPassword.request.subtitle')}
    >
      {sent ? (
        <p role='status' className='text-sm text-foreground'>
          {t('auth.resetPassword.request.sent')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label
              htmlFor='reset-email'
              className='text-xs text-muted-foreground'
            >
              {t('auth.field.email')}
            </Label>
            <Input
              id='reset-email'
              type='email'
              autoComplete='email'
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <ErrorLine id={errorId} t={t} />
          <Button type='submit' disabled={submitting} className='w-full'>
            {submitting
              ? t('auth.submitting')
              : t('auth.resetPassword.request.submit')}
          </Button>
        </form>
      )}
      <BackToSignIn t={t} />
    </ResetCard>
  )
}

/** Step 2: the link's token is in the URL — choose the new password. */
function SetNewPassword({ token }: { token: string }) {
  const t = useTranslate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [errorId, setErrorId] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setErrorId('auth.error.passwordMismatch')
      return
    }
    setSubmitting(true)
    setErrorId(null)
    try {
      const { error } = await getAuthClient().resetPassword({
        newPassword: password,
        token,
      })
      if (error) setErrorId(errorMessageId(authErrorCode(error)))
      else setDone(true)
    } catch {
      setErrorId(errorMessageId(null))
    }
    setSubmitting(false)
  }

  return (
    <ResetCard
      title={t('auth.resetPassword.set.title')}
      subtitle={t('auth.resetPassword.set.subtitle')}
    >
      {done ? (
        <p role='status' className='text-sm text-foreground'>
          {t('auth.resetPassword.set.done')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label
              htmlFor='reset-new-password'
              className='text-xs text-muted-foreground'
            >
              {t('auth.field.newPassword')}
            </Label>
            <Input
              id='reset-new-password'
              type='password'
              autoComplete='new-password'
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={submitting}
            />
            <p className='text-xs text-muted-foreground'>
              {t('auth.password.hint')}
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label
              htmlFor='reset-confirm-password'
              className='text-xs text-muted-foreground'
            >
              {t('auth.field.confirmPassword')}
            </Label>
            <Input
              id='reset-confirm-password'
              type='password'
              autoComplete='new-password'
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              disabled={submitting}
            />
          </div>
          <ErrorLine id={errorId} t={t} />
          <Button type='submit' disabled={submitting} className='w-full'>
            {submitting
              ? t('auth.submitting')
              : t('auth.resetPassword.set.submit')}
          </Button>
        </form>
      )}
      <BackToSignIn t={t} />
    </ResetCard>
  )
}

export function ResetPassword() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  if (token) return <SetNewPassword token={token} />
  const linkError = searchParams.get('error')
  return (
    <RequestResetLink
      initialErrorId={linkError ? errorMessageId(linkError) : null}
    />
  )
}
