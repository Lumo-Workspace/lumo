'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface AccountLinkingProps {
  className?: string
}

export default function AccountLinking({ className }: AccountLinkingProps) {
  const { data: session, status } = useSession()
  const [isLinking, setIsLinking] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    return <div>Please sign in to manage your account settings.</div>
  }

  // Check if user has a Google account linked
  const hasGoogleAccount = (session as any)?.accounts?.some(
    (account: any) => account.provider === 'google'
  )
  const googleAccount = (session as any)?.accounts?.find(
    (account: any) => account.provider === 'google'
  )

  const handleLinkAccount = async () => {
    setIsLinking(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/auth/account/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: 'google' }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to link account')
      }

      setSuccess('Google account linked successfully!')
      // Refresh session to get updated account info
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link account')
    } finally {
      setIsLinking(false)
    }
  }

  const handleUnlinkAccount = async () => {
    setIsUnlinking(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/auth/account/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: 'google' }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to unlink account')
      }

      setSuccess('Google account unlinked successfully!')
      setShowUnlinkDialog(false)
      // Refresh session to get updated account info
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink account')
    } finally {
      setIsUnlinking(false)
    }
  }

  const openUnlinkDialog = () => {
    setShowUnlinkDialog(true)
    setError(null)
    setSuccess(null)
  }

  const closeUnlinkDialog = () => {
    setShowUnlinkDialog(false)
    setError(null)
  }

  return (
    <div className={className}>
      <div className='space-y-4'>
        <h3 className='text-lg font-semibold'>Account Linking</h3>

        {error && (
          <div className='p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md'>
            Error: {error}
          </div>
        )}

        {success && (
          <div className='p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md'>
            {success}
          </div>
        )}

        {hasGoogleAccount ? (
          <div className='space-y-3'>
            <div className='flex items-center space-x-2'>
              <span className='text-green-600'>✓</span>
              <span className='font-medium'>Google Account Linked</span>
            </div>
            <p className='text-sm text-gray-600'>
              Connected to {googleAccount?.providerAccountId}
            </p>
            <Button
              variant='outline'
              onClick={openUnlinkDialog}
              disabled={isUnlinking}
              className='min-h-[44px] h-[44px]'
            >
              {isUnlinking ? 'Unlinking...' : 'Unlink Account'}
            </Button>
          </div>
        ) : (
          <div className='space-y-3'>
            <p className='text-sm text-gray-600'>
              Connect your Google account for easier sign-in
            </p>
            <Button
              onClick={handleLinkAccount}
              disabled={isLinking}
              className='min-h-[44px] h-[44px]'
              aria-label='Link your Google account for easier sign-in'
            >
              {isLinking ? 'Linking...' : 'Link Google Account'}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Account Unlinking</DialogTitle>
            <DialogDescription>
              Are you sure you want to unlink your Google account? You will need
              to use your email and password to sign in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={closeUnlinkDialog}
              disabled={isUnlinking}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleUnlinkAccount}
              disabled={isUnlinking}
            >
              {isUnlinking ? 'Unlinking...' : 'Yes, Unlink Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
