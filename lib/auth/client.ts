/**
 * Client-side auth entry point (LUM-1026): the provider, hooks and sign-in
 * UI for client components. Import from here, never from @/lib/auth (that
 * barrel is server-only). Implemented by Clerk today (./clerk/client, a
 * 'use client' module).
 */
export { AuthProvider, SignIn, useUser, useSignOut } from './clerk/client'
export type {
  AuthClientUser,
  SignOut,
  SignOutOptions,
  UseUserReturn,
} from './types'
