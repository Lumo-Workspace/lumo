'use client'

/**
 * Google Login Button Component
 * Redirects to Clerk sign-in page which handles Google OAuth.
 */

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/components/ui/icons'

interface GoogleLoginButtonProps {
  callbackUrl?: string
  className?: string
}

export function GoogleLoginButton({
  callbackUrl = '/workspace',
  className,
}: GoogleLoginButtonProps) {
  const router = useRouter()

  const handleSignIn = () => {
    router.push(`/signin?redirect_url=${encodeURIComponent(callbackUrl)}`)
  }

  return (
    <Button
      onClick={handleSignIn}
      variant='default'
      size='sm'
      className={`w-full h-9 rounded-md text-sm font-normal bg-slate-900 hover:bg-slate-800 text-white border-slate-900 hover:border-slate-800 transition-colors ${className || ''}`}
      aria-label='Continue with Google'
    >
      <GoogleIcon className='mr-3 h-3.5 w-3.5' />
      Continue with Google
    </Button>
  )
}
