'use client'

/**
 * Account Linking — managed by Clerk.
 * Users can manage connected accounts in the Clerk User Profile component.
 */

import { useUser } from '@clerk/nextjs'

interface AccountLinkingProps {
  className?: string
}

export default function AccountLinking({ className }: AccountLinkingProps) {
  const { isLoaded, isSignedIn } = useUser()

  if (!isLoaded) {
    return <div>Loading...</div>
  }

  if (!isSignedIn) {
    return <div>Please sign in to manage your account settings.</div>
  }

  return (
    <div className={className}>
      <div className='space-y-4'>
        <h3 className='text-lg font-semibold'>Connected Accounts</h3>
        <p className='text-sm text-gray-600'>
          Manage your connected social accounts (Google, GitHub) through your
          Clerk profile settings.
        </p>
      </div>
    </div>
  )
}
