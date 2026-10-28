'use client'

/**
 * LUM-1070 — "change password" on the profile page. Changing it signs out
 * every other session.
 * An account without a password (GitHub / Google only) is told to set one
 * through "Forgot password?" instead — a reset adds the password.
 * LUM-1082: nothing at all when the instance turned password sign-in off.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAuthClient } from './auth-client'
import { passwordEnabledIn, usePublicAuthConfig } from './public-config'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  authErrorCode,
  changePasswordErrorMessageId,
  errorMessageId,
} from './sign-in-helpers'
import { Spinner } from '@/components/ui/spinner'

/** Better Auth's provider id of an email + password account. */
const CREDENTIAL_PROVIDER_ID = 'credential'

/** `null` while loading; whether the user has an email + password account. */
function useHasPassword(): boolean | null {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data } = await getAuthClient().listAccounts()
        if (cancelled) return
        setHasPassword(
          (data ?? []).some(a => a.providerId === CREDENTIAL_PROVIDER_ID)
        )
      } catch {
        // Unknown: show the form; the server still answers for the account.
        if (!cancelled) setHasPassword(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return hasPassword
}

export function ChangePassword() {
  const config = usePublicAuthConfig()
  // Wait for the options so the card never flashes on a password-less instance.
  if (config === undefined || !passwordEnabledIn(config)) return null
  return <ChangePasswordCard />
}

function ChangePasswordCard() {
  const intl = useIntl()
  const t = (id: string) => intl.formatMessage({ id })
  const hasPassword = useHasPassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorId, setErrorId] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      setErrorId('auth.error.passwordMismatch')
      return
    }
    setSaving(true)
    setErrorId(null)
    try {
      const { error } = await getAuthClient().changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      if (error) {
        setErrorId(changePasswordErrorMessageId(authErrorCode(error)))
      } else {
        setCurrent('')
        setNext('')
        setConfirm('')
        toast.success(t('profile.password.changed'))
      }
    } catch {
      setErrorId(errorMessageId(null))
    }
    setSaving(false)
  }

  return (
    <div className='mt-6 border border-border rounded-lg overflow-hidden bg-card'>
      <div className='px-4 py-3 border-b border-border'>
        <p className='text-sm font-medium text-foreground'>
          {t('profile.password.title')}
        </p>
        <p className='text-xs text-muted-foreground'>
          {t('profile.password.hint')}
        </p>
      </div>
      {hasPassword === false ? (
        <p className='px-4 py-3 text-sm text-muted-foreground'>
          {t('profile.password.noPassword')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className='px-4 py-3 space-y-3'>
          <Input
            type='password'
            autoComplete='current-password'
            aria-label={t('auth.field.currentPassword')}
            placeholder={t('auth.field.currentPassword')}
            required
            value={current}
            onChange={e => setCurrent(e.target.value)}
            disabled={saving || hasPassword === null}
            className='h-8 text-sm'
          />
          <Input
            type='password'
            autoComplete='new-password'
            aria-label={t('auth.field.newPassword')}
            placeholder={t('auth.field.newPassword')}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={next}
            onChange={e => setNext(e.target.value)}
            disabled={saving || hasPassword === null}
            className='h-8 text-sm'
          />
          <Input
            type='password'
            autoComplete='new-password'
            aria-label={t('auth.field.confirmPassword')}
            placeholder={t('auth.field.confirmPassword')}
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            disabled={saving || hasPassword === null}
            className='h-8 text-sm'
          />
          {errorId && (
            <p role='alert' className='text-sm text-danger-text'>
              {t(errorId)}
            </p>
          )}
          <div className='flex justify-end'>
            <Button
              type='submit'
              size='sm'
              disabled={saving || hasPassword === null}
            >
              {saving ? (
                <Spinner className='size-3.5' />
              ) : (
                t('profile.password.submit')
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
