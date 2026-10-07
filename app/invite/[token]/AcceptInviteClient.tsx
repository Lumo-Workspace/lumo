'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSignOut, useUser } from '@/lib/auth/client'
import { useIntl, FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { invitesClient, ApiClientError } from '@/lib/api-client'
import { INVITE_EMAIL_MISMATCH } from '@/lib/utils/invite'
import { InviteEmailMismatch } from './InviteEmailMismatch'

interface Props {
  token: string
  workspaceName: string
  workspaceSlug: string
  inviterName: string
  /** The invited address, masked (`a***@acme.com`) — never the full one. */
  maskedEmail: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
}

export function AcceptInviteClient({
  token,
  workspaceName,
  workspaceSlug,
  inviterName,
  maskedEmail,
  status,
}: Props) {
  const intl = useIntl()
  const { isLoaded, isSignedIn } = useUser()
  const signOut = useSignOut()
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailMismatch, setEmailMismatch] = useState(false)
  const inviteUrl = `/invite/${token}`

  useEffect(() => {
    if (!isLoaded || !isSignedIn || status !== 'PENDING') return

    let cancelled = false
    const controller = new AbortController()
    setAccepting(true)

    async function run() {
      try {
        const data = await invitesClient.accept(token, {
          signal: controller.signal,
        })
        if (cancelled) return
        router.push(`/workspace/${data.workspaceSlug}`)
      } catch (err: unknown) {
        if (cancelled) return
        if (
          err instanceof ApiClientError &&
          err.code === INVITE_EMAIL_MISMATCH
        ) {
          setEmailMismatch(true)
          setAccepting(false)
          return
        }
        setError(
          err instanceof ApiClientError
            ? err.message
            : intl.formatMessage({ id: 'invite.error.network' })
        )
        setAccepting(false)
      }
    }
    run()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isLoaded, isSignedIn, status, token, router, intl])

  if (status === 'ACCEPTED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.accepted.title' })}
        </h2>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'invite.accepted.body' })}
        </p>
        <Button onClick={() => router.push(`/workspace/${workspaceSlug}`)}>
          {intl.formatMessage({ id: 'invite.accepted.cta' })}
        </Button>
      </>
    )
  }

  if (status === 'EXPIRED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.expired.title' })}
        </h2>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'invite.expired.body' })}
        </p>
      </>
    )
  }

  if (status === 'REVOKED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.revoked.title' })}
        </h2>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'invite.revoked.body' })}
        </p>
      </>
    )
  }

  // PENDING — loading or auto-accepting
  if (!isLoaded || accepting) {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.joining' }, { workspaceName })}
        </h2>
        <div className='flex justify-center'>
          <Spinner className='size-5 text-muted-foreground' />
        </div>
      </>
    )
  }

  if (emailMismatch) {
    return (
      <InviteEmailMismatch
        maskedEmail={maskedEmail}
        workspaceName={workspaceName}
        onSwitchAccount={() =>
          void signOut({
            redirectUrl: `/signin?redirect_url=${encodeURIComponent(inviteUrl)}`,
          })
        }
      />
    )
  }

  if (error) {
    return (
      <>
        <h2 className='text-lg font-semibold text-danger-text'>
          {intl.formatMessage({ id: 'invite.error.title' })}
        </h2>
        <p className='text-sm text-muted-foreground'>{error}</p>
        <Button variant='outline' onClick={() => setError(null)}>
          {intl.formatMessage({ id: 'invite.error.tryAgain' })}
        </Button>
      </>
    )
  }

  // Not signed in — show CTA
  return (
    <>
      <h2 className='text-lg font-semibold'>
        <FormattedMessage
          id='invite.signup.title'
          values={{
            inviterName,
            workspaceName: (
              <span className='text-foreground'>{workspaceName}</span>
            ),
          }}
        />
      </h2>
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage(
          { id: 'invite.signup.forEmail' },
          { email: maskedEmail }
        )}{' '}
        {intl.formatMessage({ id: 'invite.signup.body' })}
      </p>
      <div className='flex flex-col gap-2'>
        <Button asChild className='w-full'>
          <a href={`/signup?redirect_url=${encodeURIComponent(inviteUrl)}`}>
            {intl.formatMessage({ id: 'invite.signup.create' })}
          </a>
        </Button>
        <Button asChild variant='outline' className='w-full'>
          <a href={`/signin?redirect_url=${encodeURIComponent(inviteUrl)}`}>
            {intl.formatMessage({ id: 'invite.signup.signin' })}
          </a>
        </Button>
      </div>
    </>
  )
}
