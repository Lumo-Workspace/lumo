/**
 * Client-side auth entry point (LUM-1026): the provider, hooks and sign-in
 * UI for client components. Import from here, never from @/lib/auth (that
 * barrel is server-only). The implementation is Better Auth (LUM-1027,
 * ./client-components, a 'use client' module).
 */
export {
  AuthProvider,
  OAuthConsent,
  PasswordSettings,
  ResetPassword,
  SignIn,
  useUser,
  useSignOut,
} from './client-components'
export type {
  AuthClientUser,
  SignOut,
  SignOutOptions,
  UseUserReturn,
} from './types'
