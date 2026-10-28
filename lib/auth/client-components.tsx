'use client'

/**
 * LUM-1027 — the client-side auth implementation (Better Auth): provider,
 * hooks and the sign-in / consent / password UI. The forms are code-split so
 * a page only downloads the one it renders.
 */
import { Suspense, lazy, type ReactNode } from 'react'
import * as betterAuth from './better-auth/client'
import type { SignOut, UseUserReturn } from './types'

const SignInForm = lazy(async () => ({
  default: (await import('./better-auth/sign-in-form')).SignIn,
}))

const ConsentForm = lazy(async () => ({
  default: (await import('./better-auth/consent-form')).OAuthConsent,
}))

const ResetPasswordForm = lazy(async () => ({
  default: (await import('./better-auth/reset-password-form')).ResetPassword,
}))

const ChangePasswordForm = lazy(async () => ({
  default: (await import('./better-auth/change-password-form')).ChangePassword,
}))

/** Mount once at the app root; every hook below needs it. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <betterAuth.AuthProvider>{children}</betterAuth.AuthProvider>
}

/** The sign-in UI (mounted on /signin). */
export function SignIn() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}

/**
 * Consent screen of the MCP OAuth authorization server (LUM-1044, mounted on
 * /oauth/consent).
 */
export function OAuthConsent() {
  return (
    <Suspense fallback={null}>
      <ConsentForm />
    </Suspense>
  )
}

/** Forgot / reset password (LUM-1070, mounted on /reset-password). */
export function ResetPassword() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}

/** LUM-1070 — the change-password section of the profile page. */
export function PasswordSettings() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordForm />
    </Suspense>
  )
}

/** The signed-in user, with loading and signed-in state. */
export function useUser(): UseUserReturn {
  return betterAuth.useUser()
}

/** A function that ends the session, then navigates to `redirectUrl`. */
export function useSignOut(): SignOut {
  return betterAuth.useSignOut()
}
