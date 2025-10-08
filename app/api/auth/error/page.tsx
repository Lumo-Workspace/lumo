import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/auth/errors'

/**
 * OAuth Error Page
 *
 * Displays user-friendly error messages when OAuth authentication fails
 *
 * Requirements:
 * - UR-005: Clear, actionable error messages
 * - UX-001: WCAG 2.1 AA compliance
 * - UX-002: Responsive design with touch targets ≥44px
 *
 * @see specs/001-google/research.md Section 9
 */

export default async function ErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const errorCode = params.error ?? null
  const errorInfo = getErrorMessage(errorCode)

  return (
    <div className='flex min-h-screen items-center justify-center p-4 bg-gray-50'>
      <div className='w-full max-w-md space-y-6'>
        {/* Logo/Header */}
        <div className='text-center'>
          <h1 className='text-2xl font-bold tracking-tight'>
            Authentication Error
          </h1>
          <p className='text-sm text-gray-600 mt-2'>
            We encountered a problem signing you in
          </p>
        </div>

        {/* Error Alert */}
        <Alert variant='destructive' className='border-red-200 bg-red-50'>
          <AlertCircle className='h-5 w-5' aria-hidden='true' />
          <AlertTitle className='text-lg font-semibold'>
            {errorInfo.title}
          </AlertTitle>
          <AlertDescription className='mt-2 text-sm'>
            {errorInfo.description}
          </AlertDescription>
        </Alert>

        {/* Action Buttons */}
        <div className='space-y-3'>
          <Button
            asChild
            className='w-full h-11 text-base'
            size='lg'
            aria-label={errorInfo.action}
          >
            <Link href='/login'>{errorInfo.action}</Link>
          </Button>

          <Button
            asChild
            variant='outline'
            className='w-full h-11 text-base'
            size='lg'
            aria-label='Go back to home page'
          >
            <Link href='/'>Back to Home</Link>
          </Button>
        </div>

        {/* Debug Info (dev only) */}
        {process.env.NODE_ENV === 'development' && errorCode && (
          <div className='mt-4 p-3 bg-gray-100 rounded-md text-xs text-gray-600'>
            <strong>Debug Info:</strong> Error code: {errorCode}
          </div>
        )}

        {/* Help Text */}
        <div className='text-center text-sm text-gray-600'>
          Need help?{' '}
          <Link
            href='/support'
            className='font-medium text-blue-600 hover:text-blue-500 underline'
            aria-label='Contact support'
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  )
}
