'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

interface Props {
  token: string
  workspaceName: string
  workspaceSlug: string
  inviterName: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
}

export function AcceptInviteClient({
  token,
  workspaceName,
  workspaceSlug,
  inviterName,
  status,
}: Props) {
  const { isLoaded, isSignedIn } = useUser()
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn || status !== 'PENDING') return

    setAccepting(true)
    fetch(`/api/invites/${token}/accept`, { method: 'POST' })
      .then(async res => {
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Failed to accept invitation')
          setAccepting(false)
        } else {
          router.push(`/workspace/${data.workspaceSlug}`)
        }
      })
      .catch(() => {
        setError('Something went wrong. Please try again.')
        setAccepting(false)
      })
  }, [isLoaded, isSignedIn, status, token, router])

  if (status === 'ACCEPTED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>Invitation already accepted</h2>
        <p className='text-sm text-slate-500'>
          This invite link has already been used.
        </p>
        <Button onClick={() => router.push(`/workspace/${workspaceSlug}`)}>
          Go to workspace
        </Button>
      </>
    )
  }

  if (status === 'EXPIRED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>Invitation expired</h2>
        <p className='text-sm text-slate-500'>
          This invite link has expired. Ask your teammate to send a new one.
        </p>
      </>
    )
  }

  if (status === 'REVOKED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>Invitation revoked</h2>
        <p className='text-sm text-slate-500'>
          This invite link is no longer valid.
        </p>
      </>
    )
  }

  // PENDING — loading or auto-accepting
  if (!isLoaded || accepting) {
    return (
      <>
        <h2 className='text-lg font-semibold'>Joining {workspaceName}…</h2>
        <div className='flex justify-center'>
          <Spinner className='size-5 text-slate-400' />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <h2 className='text-lg font-semibold text-red-600'>
          Something went wrong
        </h2>
        <p className='text-sm text-slate-500'>{error}</p>
        <Button variant='outline' onClick={() => setError(null)}>
          Try again
        </Button>
      </>
    )
  }

  // Not signed in — show CTA
  const inviteUrl = `/invite/${token}`
  return (
    <>
      <h2 className='text-lg font-semibold'>
        {inviterName} invited you to join{' '}
        <span className='text-slate-900'>{workspaceName}</span>
      </h2>
      <p className='text-sm text-slate-500'>
        Sign up or sign in to accept the invitation.
      </p>
      <div className='flex flex-col gap-2'>
        <Button asChild className='w-full'>
          <a href={`/signup?redirect_url=${encodeURIComponent(inviteUrl)}`}>
            Create account
          </a>
        </Button>
        <Button asChild variant='outline' className='w-full'>
          <a href={`/signin?redirect_url=${encodeURIComponent(inviteUrl)}`}>
            Sign in
          </a>
        </Button>
      </div>
    </>
  )
}
