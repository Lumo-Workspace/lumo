import { GoogleLoginButton } from '@/components/auth/google-login-button'
import { AuthErrorAlert } from '@/components/auth/auth-error-alert'

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
    <div className='min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8'>
      <div className='max-w-md w-full space-y-6'>
        {/* Header */}
        <div className='text-center'>
          <h1 className='text-3xl font-bold tracking-tight text-gray-900'>
            Sign in to your account
          </h1>
          <p className='mt-2 text-sm text-gray-600'>
            Use your Google account to sign in quickly and securely
          </p>
        </div>

        {/* Error Alert */}
        {params.error && (
          <AuthErrorAlert
            error={params.error}
            onRetry={() => (window.location.href = '/login')}
          />
        )}

        {/* Login Button */}
        <div>
          <GoogleLoginButton className='w-full' />
        </div>

        {/* Footer */}
        <div className='text-center'>
          <p className='text-xs text-gray-500'>
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  )
}
