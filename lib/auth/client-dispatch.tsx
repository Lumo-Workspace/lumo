'use client'

/**
 * LUM-1027 — picks the client-side auth implementation. The server reads
 * AUTH_PROVIDER and hands its name to <AuthProvider provider=…> (root layout →
 * Providers); every hook and the sign-in UI then use that implementation
 * through context. Without a `provider` prop it is Clerk, as before.
 */
import {
  Suspense,
  createContext,
  lazy,
  useContext,
  type ReactNode,
} from 'react'
import * as clerk from './clerk/client'
import * as betterAuth from './better-auth/client'
import type { AuthProviderName } from './provider'
import type { SignOut, UseUserReturn } from './types'

interface ClientAuthImplementation {
  Provider: (props: { children: ReactNode }) => ReactNode
  SignIn: () => ReactNode
  useUser: () => UseUserReturn
  useSignOut: () => SignOut
}

// Code-split: only a Better Auth deployment ever renders its sign-in form.
const BetterAuthSignInForm = lazy(async () => ({
  default: (await import('./better-auth/sign-in-form')).SignIn,
}))

function BetterAuthSignIn() {
  return (
    <Suspense fallback={null}>
      <BetterAuthSignInForm />
    </Suspense>
  )
}

const IMPLEMENTATIONS: Record<AuthProviderName, ClientAuthImplementation> = {
  clerk: {
    Provider: clerk.AuthProvider,
    SignIn: clerk.SignIn,
    useUser: clerk.useUser,
    useSignOut: clerk.useSignOut,
  },
  'better-auth': {
    Provider: betterAuth.AuthProvider,
    SignIn: BetterAuthSignIn,
    useUser: betterAuth.useUser,
    useSignOut: betterAuth.useSignOut,
  },
}

const ImplementationContext = createContext<ClientAuthImplementation>(
  IMPLEMENTATIONS.clerk
)

/** Mount once at the app root; every hook below needs it. */
export function AuthProvider({
  provider = 'clerk',
  children,
}: {
  provider?: AuthProviderName | undefined
  children: ReactNode
}) {
  const impl = IMPLEMENTATIONS[provider]
  return (
    <ImplementationContext.Provider value={impl}>
      <impl.Provider>{children}</impl.Provider>
    </ImplementationContext.Provider>
  )
}

/** The provider's sign-in UI (mounted on /signin). */
export function SignIn() {
  const impl = useContext(ImplementationContext)
  return <impl.SignIn />
}

/**
 * The signed-in user, with loading and signed-in state. The implementation is
 * fixed for the app's lifetime, so the same hook runs on every render.
 */
export function useUser(): UseUserReturn {
  return useContext(ImplementationContext).useUser()
}

/** A function that ends the session, then navigates to `redirectUrl`. */
export function useSignOut(): SignOut {
  return useContext(ImplementationContext).useSignOut()
}
