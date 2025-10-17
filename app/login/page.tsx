import Image from 'next/image'
import { GoogleLoginButton } from '@/components/features/user-management/auth/google-login-button'
import { AuthErrorAlert } from '@/components/features/user-management/auth/auth-error-alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Login Page
 *
 * Requirements:
 * - UR-001: "Continue with Google" button
 * - UR-005: Display OAuth errors
 * - UX-002: Responsive design
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4 sm:px-6 lg:px-8'>
      <Card className='w-full max-w-md shadow-xl'>
        <CardHeader className='text-center space-y-6'>
          {/* Logo */}
          <div className='flex justify-center'>
            <Image
              src='/logo-dark.png'
              alt='Lumo Logo'
              width={62}
              height={62}
              className='h-15 w-15'
              priority
            />
          </div>

          {/* Title */}
          <CardTitle className='text-sm font-normal text-slate-900'>
            Sign in to Lumo
          </CardTitle>
        </CardHeader>

        <CardContent className='space-y-6'>
          {/* Error Alert */}
          {params.error && (
            <AuthErrorAlert
              error={params.error}
              onRetry={() => (window.location.href = '/login')}
            />
          )}

          {/* Login Button */}
          <GoogleLoginButton className='w-full' />

          {/* Footer */}
          <div className='text-center'>
            <p className='text-xs text-slate-500'>
              By signing in, you agree to our{' '}
              <a
                href='#'
                className='text-slate-600 hover:text-slate-800 underline'
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href='#'
                className='text-slate-600 hover:text-slate-800 underline'
              >
                Privacy Policy
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
