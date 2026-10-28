'use client'

/**
 * LUM-1027 — Better Auth implementation of the client-side auth interface:
 * provider and hooks. The sign-in UI is ./sign-in-form, loaded lazily by
 * ../client-components.
 */
import { useMemo, type ReactNode } from 'react'
import type { SignOut, UseUserReturn } from '../types'
import { getAuthClient } from './auth-client'
import { hardNavigate } from './navigate'

/** Better Auth's client keeps its own store — nothing to mount. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

type SessionUser = {
  id: string
  name: string
  email: string
  image?: string | null
  firstName?: string | null
  lastName?: string | null
}

/** The signed-in user, with loading and signed-in state. */
export function useUser(): UseUserReturn {
  const { data, isPending, refetch } = getAuthClient().useSession()
  const sessionUser = (data?.user ?? null) as SessionUser | null
  return useMemo((): UseUserReturn => {
    if (isPending) {
      return { isLoaded: false, isSignedIn: undefined, user: undefined }
    }
    if (!sessionUser) return { isLoaded: true, isSignedIn: false, user: null }
    return {
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: sessionUser.id,
        firstName: sessionUser.firstName ?? null,
        lastName: sessionUser.lastName ?? null,
        imageUrl: sessionUser.image ?? '',
        emailAddresses: [{ emailAddress: sessionUser.email }],
        // Bypass the session cookie cache so a profile write shows at once.
        reload: () => refetch({ query: { disableCookieCache: true } }),
      },
    }
  }, [isPending, sessionUser, refetch])
}

/** Ends the session, then does a full navigation to `redirectUrl` (or /). */
export function useSignOut(): SignOut {
  return async options => {
    await getAuthClient().signOut()
    hardNavigate(options?.redirectUrl ?? '/')
  }
}
