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
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { GoogleIcon, SpinnerIcon } from '@/components/ui/icons'

interface GoogleLoginButtonProps {
  callbackUrl?: string
  className?: string
}

export function GoogleLoginButton({
  callbackUrl = '/dashboard',
  className,
}: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = async () => {
    try {
      setIsLoading(true)
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
      variant='outline'
      size='lg'
      className={`w-full h-11 text-base ${className || ''}`}
      aria-label={
        isLoading ? 'Signing in with Google...' : 'Continue with Google'
      }
    >
      {isLoading ? (
        <>
          <SpinnerIcon className='mr-2 h-5 w-5 animate-spin' />
          Signing in...
        </>
      ) : (
        <>
          <GoogleIcon className='mr-2 h-5 w-5' />
          Continue with Google
        </>
      )}
    </Button>
  )
}
