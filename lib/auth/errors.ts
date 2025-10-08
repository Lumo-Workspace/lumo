/**
 * OAuth Authentication Error Types and Messages
 *
 * Provides user-friendly error messages for OAuth failures
 *
 * Requirements:
 * - UR-005: Clear error messages for authentication failures
 * - SR-011: Handle all OAuth error states
 *
 * @see specs/001-google/research.md Section 9
 */

/**
 * OAuth error types from NextAuth.js and Google OAuth
 */
export enum OAuthErrorType {
  // OAuth standard errors (RFC 6749)
  AccessDenied = 'AccessDenied', // User denied consent
  Configuration = 'Configuration', // OAuth misconfiguration
  Verification = 'Verification', // Email verification failed

  // Custom application errors
  SessionExpired = 'SessionExpired', // Session timeout
  AccountExists = 'AccountExists', // Email already linked
  InvalidCredentials = 'InvalidCredentials', // Invalid OAuth credentials
  TokenExpired = 'TokenExpired', // Access token expired
  NetworkError = 'NetworkError', // Network failure
  DatabaseError = 'DatabaseError', // Database operation failed
  UnknownError = 'Default', // Catch-all error
}

/**
 * User-friendly error messages mapped to error types
 * These messages are displayed to end users on the error page
 */
export const ERROR_MESSAGES: Record<
  OAuthErrorType,
  { title: string; description: string; action: string }
> = {
  [OAuthErrorType.AccessDenied]: {
    title: 'Google Authorization Failed',
    description:
      'You denied access to your Google account. To continue, you need to grant permission.',
    action: 'Try Again',
  },
  [OAuthErrorType.Configuration]: {
    title: 'Configuration Error',
    description:
      'There is a problem with the authentication setup. Please contact support if this persists.',
    action: 'Contact Support',
  },
  [OAuthErrorType.Verification]: {
    title: 'Email Verification Failed',
    description:
      'We could not verify your email address. Please ensure your Google account email is verified.',
    action: 'Try Again',
  },
  [OAuthErrorType.SessionExpired]: {
    title: 'Session Expired',
    description: 'Your session has expired. Please sign in again to continue.',
    action: 'Sign In Again',
  },
  [OAuthErrorType.AccountExists]: {
    title: 'Account Already Exists',
    description:
      'An account with this email already exists. Please sign in with your existing account.',
    action: 'Go to Sign In',
  },
  [OAuthErrorType.InvalidCredentials]: {
    title: 'Invalid Credentials',
    description:
      'The authentication credentials are invalid. Please try signing in again.',
    action: 'Try Again',
  },
  [OAuthErrorType.TokenExpired]: {
    title: 'Authentication Expired',
    description:
      'Your authentication has expired. Please sign in again to continue.',
    action: 'Sign In Again',
  },
  [OAuthErrorType.NetworkError]: {
    title: 'Network Error',
    description:
      'Unable to connect to Google. Please check your internet connection and try again.',
    action: 'Try Again',
  },
  [OAuthErrorType.DatabaseError]: {
    title: 'System Error',
    description:
      'A system error occurred. Our team has been notified. Please try again later.',
    action: 'Try Again',
  },
  [OAuthErrorType.UnknownError]: {
    title: 'Something Went Wrong',
    description:
      'An unexpected error occurred during sign in. Please try again or contact support.',
    action: 'Try Again',
  },
}

/**
 * Map NextAuth error codes to our error types
 */
export function mapNextAuthError(error: string | null): OAuthErrorType {
  if (!error) {
    return OAuthErrorType.UnknownError
  }

  const errorLower = error.toLowerCase()

  // Map known NextAuth error codes
  if (errorLower.includes('accessdenied')) {
    return OAuthErrorType.AccessDenied
  }
  if (errorLower.includes('configuration')) {
    return OAuthErrorType.Configuration
  }
  if (errorLower.includes('verification')) {
    return OAuthErrorType.Verification
  }
  if (errorLower.includes('session')) {
    return OAuthErrorType.SessionExpired
  }
  if (errorLower.includes('oauthaccountnotlinked')) {
    return OAuthErrorType.AccountExists
  }
  if (errorLower.includes('oauthcallback')) {
    return OAuthErrorType.InvalidCredentials
  }

  return OAuthErrorType.UnknownError
}

/**
 * Get error message details for an error code
 */
export function getErrorMessage(error: string | null): {
  title: string
  description: string
  action: string
} {
  const errorType = mapNextAuthError(error)
  return ERROR_MESSAGES[errorType]
}
