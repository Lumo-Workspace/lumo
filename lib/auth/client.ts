/**
 * Client-side auth entry point (LUM-1026): the provider, hooks and sign-in
 * UI for client components. Import from here, never from @/lib/auth (that
 * barrel is server-only). The implementation (Clerk or Better Auth,
 * LUM-1027) is chosen by the `provider` prop of <AuthProvider>
 * (./client-dispatch, a 'use client' module).
 */
export { AuthProvider, SignIn, useUser, useSignOut } from './client-dispatch'
export type { AuthProviderName } from './provider'
export type {
  AuthClientUser,
  SignOut,
  SignOutOptions,
  UseUserReturn,
} from './types'
