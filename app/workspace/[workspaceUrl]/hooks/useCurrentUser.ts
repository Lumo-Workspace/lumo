'use client'

import { useMemo } from 'react'
import { useUser } from '@/lib/auth/client'

export interface CurrentUser {
  /** Clerk user ID */
  id: string
  firstName: string | null
  lastName: string | null
  imageUrl: string
  email: string | null
  /** firstName or email fallback */
  displayName: string
  /** First letter of displayName, uppercased */
  initials: string
}

export interface UseCurrentUserReturn {
  user: CurrentUser | null
  isLoaded: boolean
  isSignedIn: boolean | undefined
}

/**
 * Thin wrapper around the auth provider's useUser that flattens deeply nested fields
 * (email, displayName, initials) so consumers don't violate LoD.
 */
export function useCurrentUser(): UseCurrentUserReturn {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser()

  const user = useMemo<CurrentUser | null>(() => {
    if (!clerkUser) return null

    const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? null
    const displayName = clerkUser.firstName
      ? `${clerkUser.firstName} ${clerkUser.lastName ?? ''}`.trim()
      : (email ?? '')
    const initials =
      clerkUser.firstName?.[0]?.toUpperCase() ??
      email?.[0]?.toUpperCase() ??
      '?'

    return {
      id: clerkUser.id,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
      email,
      displayName,
      initials,
    }
  }, [clerkUser])

  return { user, isLoaded, isSignedIn }
}
