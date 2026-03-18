'use client'

/**
 * UserProfileContent — now delegates to UserProfileClient using Clerk.
 * Kept for backward compatibility with existing imports.
 */

import { UserProfileClient } from './user-profile-client'

interface UserProfileContentProps {
  className?: string
  showPreferences?: boolean
  showSettings?: boolean
  // session prop kept for API compatibility but ignored (Clerk handles auth)
  session?: unknown
}

export function UserProfileContent({
  className,
  showPreferences = false,
  showSettings = false,
}: UserProfileContentProps) {
  return (
    <UserProfileClient
      {...(className && { className })}
      showPreferences={showPreferences}
      showSettings={showSettings}
    />
  )
}
