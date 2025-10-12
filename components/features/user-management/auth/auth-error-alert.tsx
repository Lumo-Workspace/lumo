'use client'

/**
 * Authentication Error Alert Component
 *
 * Displays user-friendly error messages for OAuth failures
 *
 * Requirements:
 * - UR-005: Clear error messages for authentication failures
 * - UX-001: WCAG 2.1 AA compliance (ARIA live region)
 */

import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/auth/errors'

interface AuthErrorAlertProps {
  error: string | null
  onRetry?: () => void
  className?: string
}

export function AuthErrorAlert({
  error,
  onRetry,
  className,
}: AuthErrorAlertProps) {
  if (!error) return null

  const errorInfo = getErrorMessage(error)

  return (
    <Alert
      variant='destructive'
      className={`border-red-200 bg-red-50 ${className || ''}`}
      role='alert'
      aria-live='assertive'
      aria-atomic='true'
    >
      <AlertCircle className='h-5 w-5' aria-hidden='true' />
      <AlertTitle className='text-lg font-semibold'>
        {errorInfo.title}
      </AlertTitle>
      <AlertDescription className='mt-2 space-y-3'>
        <p className='text-sm'>{errorInfo.description}</p>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant='outline'
            size='sm'
            className='mt-2'
            aria-label={errorInfo.action}
          >
            {errorInfo.action}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
