import { GoogleLoginButton } from '@/components/auth/google-login-button'

export default function LoginPage() {
  return (
    <div className='min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8'>
      <div className='max-w-md w-full space-y-8'>
        <div>
          <h2 className='mt-6 text-center text-3xl font-extrabold text-gray-900'>
            Sign in to your account
          </h2>
          <p className='mt-2 text-center text-sm text-gray-600'>
            Use your Google account to sign in quickly and securely
          </p>
        </div>

        <div className='mt-8'>
          <GoogleLoginButton className='w-full' />
        </div>

        <div className='mt-6 text-center'>
          <p className='text-xs text-gray-500'>
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  )
}
