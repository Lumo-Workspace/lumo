'use client'

import React, { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'

interface GoogleLoginButtonProps {
  callbackUrl?: string
  className?: string
}

export function GoogleLoginButton({
  callbackUrl = '/dashboard',
  className,
}: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await signIn('google', {
        callbackUrl,
        redirect: true,
      })

      if (result?.error) {
        setError('An error occurred during sign in. Please try again.')
      }
    } catch (err) {
      setError('An error occurred during sign in. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleGoogleSignIn()
    }
  }

  return (
    <div className='flex flex-col items-center gap-4'>
      <Button
        onClick={handleGoogleSignIn}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        className={`min-h-[44px] h-[44px] ${className || ''}`}
        variant='outline'
        aria-label='Sign in with Google'
      >
        {isLoading ? (
          <>
            <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-current' />
            Signing in...
          </>
        ) : (
          <>
            <svg className='w-5 h-5' viewBox='0 0 24 24' aria-hidden='true'>
              <path
                fill='#4285F4'
                d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
              />
              <path
                fill='#34A853'
                d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
              />
              <path
                fill='#FBBC05'
                d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
              />
              <path
                fill='#EA4335'
                d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
              />
            </svg>
            Sign in with Google
          </>
        )}
      </Button>

      {error && (
        <div
          className='text-sm text-red-600 text-center'
          role='alert'
          aria-live='polite'
        >
          {error}
        </div>
      )}
    </div>
  )
}
