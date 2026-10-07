'use client'

/**
 * Clerk implementation of the client-side auth interface (LUM-1026):
 * provider, hooks and the hosted sign-in UI.
 */
import {
  ClerkProvider,
  SignIn as ClerkSignIn,
  useClerk,
  useUser as useClerkUser,
} from '@clerk/nextjs'
import type { ReactNode } from 'react'
import type { SignOut, UseUserReturn } from '../types'

/** Mount once at the app root; every hook below needs it. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>
}

/** The provider's sign-in UI (mounted on /signin). */
export function SignIn() {
  return <ClerkSignIn />
}

/** The signed-in user, with loading and signed-in state. */
export function useUser(): UseUserReturn {
  return useClerkUser()
}

/** A function that ends the session, then navigates to `redirectUrl`. */
export function useSignOut(): SignOut {
  const { signOut } = useClerk()
  return signOut
}
