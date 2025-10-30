'use client'

/**
 * Google Login Button Component
 *
 * Requirements:
 * - UR-001: "Continue with Google" button on login page
 * - UX-001: WCAG 2.1 AA compliance
 * - UX-002: Touch targets ≥44px
 * - UX-003: Loading states
 */

import { useState } from 'react'
import { signIn, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { GoogleIcon, SpinnerIcon } from '@/components/ui/icons'

interface GoogleLoginButtonProps {
  callbackUrl?: string
  className?: string
}

export function GoogleLoginButton({
  callbackUrl = '/app',
  className,
}: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = async () => {
    try {
      setIsLoading(true)
      await signOut({ redirect: false })
      await signIn('google', { callbackUrl })
    } catch (error) {
      console.error('Failed to initiate Google sign in:', error)
      setIsLoading(false)
    }
  }

  return (
    <Button
      onClick={handleSignIn}
      disabled={isLoading}
      variant='default'
      size='sm'
      className={`w-full h-9 rounded-md text-sm font-normal bg-slate-900 hover:bg-slate-800 text-white border-slate-900 hover:border-slate-800 transition-colors ${className || ''}`}
      aria-label={
        isLoading ? 'Signing in with Google...' : 'Continue with Google'
      }
    >
      {isLoading ? (
        <>
          <SpinnerIcon className='mr-3 h-5 w-5 animate-spin' />
          Signing in...
        </>
      ) : (
        <>
          <GoogleIcon className='mr-3 h-3.5 w-3.5' />
          Continue with Google
        </>
      )}
    </Button>
  )
}
