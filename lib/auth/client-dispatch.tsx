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
  PasswordSettings: () => ReactNode
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

const BetterAuthConsentForm = lazy(async () => ({
  default: (await import('./better-auth/consent-form')).OAuthConsent,
}))

/**
 * Consent screen of the self-hosted MCP OAuth authorization server
 * (LUM-1044, mounted on /oauth/consent). Better Auth only — under Clerk the
 * page does not exist (Clerk hosts its own consent).
 */
export function OAuthConsent() {
  return (
    <Suspense fallback={null}>
      <BetterAuthConsentForm />
    </Suspense>
  )
}

const BetterAuthResetPasswordForm = lazy(async () => ({
  default: (await import('./better-auth/reset-password-form')).ResetPassword,
}))

/**
 * Forgot / reset password (LUM-1070, mounted on /reset-password). Better Auth
 * only — Clerk hosts its own reset flow, and the page is a 404 there.
 */
export function ResetPassword() {
  return (
    <Suspense fallback={null}>
      <BetterAuthResetPasswordForm />
    </Suspense>
  )
}

const BetterAuthChangePasswordForm = lazy(async () => ({
  default: (await import('./better-auth/change-password-form')).ChangePassword,
}))

function BetterAuthPasswordSettings() {
  return (
    <Suspense fallback={null}>
      <BetterAuthChangePasswordForm />
    </Suspense>
  )
}

/** Clerk: Lumo shows no password settings (unchanged). */
function NoPasswordSettings() {
  return null
}

const IMPLEMENTATIONS: Record<AuthProviderName, ClientAuthImplementation> = {
  clerk: {
    Provider: clerk.AuthProvider,
    SignIn: clerk.SignIn,
    PasswordSettings: NoPasswordSettings,
    useUser: clerk.useUser,
    useSignOut: clerk.useSignOut,
  },
  'better-auth': {
    Provider: betterAuth.AuthProvider,
    SignIn: BetterAuthSignIn,
    PasswordSettings: BetterAuthPasswordSettings,
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
 * LUM-1070 — the change-password section of the profile page: Better Auth's
 * form, nothing under Clerk.
 */
export function PasswordSettings() {
  const impl = useContext(ImplementationContext)
  return <impl.PasswordSettings />
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
