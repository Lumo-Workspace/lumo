/**
 * LUM-1026 — the auth interface the rest of Lumo depends on.
 *
 * These types describe only what call sites actually read, so any provider
 * can satisfy them. Clerk (lib/auth/clerk/*) is the SaaS implementation;
 * its SDK objects satisfy these shapes structurally, so the Clerk
 * implementation hands them through unchanged. The Better Auth implementation
 * (lib/auth/better-auth/*, LUM-1027) builds the same shapes from its own user
 * records; AUTH_PROVIDER (lib/auth/provider.ts) picks one per deployment.
 *
 * Nothing in this file may import a provider SDK.
 */
import type { NextRequest } from 'next/server'

/** One email address of a user. */
export interface AuthEmailAddress {
  id: string
  emailAddress: string
  /** `status === 'verified'` is the only state that may grant access. */
  verification?: { status: string } | null
}

/** A user as seen by server code (services, routes, server components). */
export interface AuthUser {
  id: string
  firstName: string | null
  lastName: string | null
  username: string | null
  imageUrl: string
  primaryEmailAddressId: string | null
  primaryEmailAddress?: AuthEmailAddress | null
  emailAddresses: AuthEmailAddress[]
}

/**
 * Filters for a batch user lookup. `limit` is a page-size cap (max 500).
 * Clerk accepts at most 100 `userId`s per call: look users up by id through
 * `listUsersByIds` (`@/lib/auth/user-batch`), which pages them (LUM-1105).
 */
export interface UserListQuery {
  userId?: string[]
  emailAddress?: string[]
  limit?: number
}

export interface UserNameUpdate {
  firstName?: string
  lastName?: string
}

/**
 * Server-side user lookups and profile writes — the directory of identities
 * the auth provider owns. Lookups by id/email for display names, avatars and
 * notification addresses; writes for the user's own profile page.
 */
export interface UserDirectory {
  /** Rejects when the user does not exist. */
  getUser(userId: string): Promise<AuthUser>
  /** Users that no longer exist are simply absent from `data`. */
  getUserList(query: UserListQuery): Promise<{ data: AuthUser[] }>
  updateUser(userId: string, update: UserNameUpdate): Promise<unknown>
  updateUserProfileImage(
    userId: string,
    params: { file: Blob | File }
  ): Promise<unknown>
}

/** The signed-in user as seen by client components. */
export interface AuthClientUser {
  id: string
  firstName: string | null
  lastName: string | null
  imageUrl: string
  emailAddresses: ReadonlyArray<{ emailAddress: string }>
  /** Re-fetch this user after a server-side profile write. */
  reload(): Promise<unknown>
}

/** Result of the client `useUser()` hook. */
export type UseUserReturn =
  | { isLoaded: false; isSignedIn: undefined; user: undefined }
  | { isLoaded: true; isSignedIn: false; user: null }
  | { isLoaded: true; isSignedIn: true; user: AuthClientUser }

export interface SignOutOptions {
  /** Where to navigate once the session has ended. */
  redirectUrl?: string
}

export type SignOut = (options?: SignOutOptions) => Promise<void>

/** What the middleware handler can ask about the current request. */
export interface MiddlewareAuth {
  /** The signed-in user's id, or null for an anonymous request. */
  userId(): Promise<string | null>
  /**
   * Require a signed-in user: an anonymous page request is redirected to
   * sign-in (the provider throws a control-flow signal the framework handles).
   */
  protect(): Promise<void>
}

/** The proxy.ts handler: sees only `MiddlewareAuth`, never a provider SDK. */
export type AuthMiddlewareHandler = (
  auth: MiddlewareAuth,
  request: NextRequest
) => Promise<Response | undefined | void>
