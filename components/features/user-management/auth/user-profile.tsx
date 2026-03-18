'use client'

import { UserProfileClient } from './user-profile-client'

interface UserProfileProps {
  className?: string
  showPreferences?: boolean
  showSettings?: boolean
  // session prop kept for API compatibility but ignored (Clerk handles auth)
  session?: unknown
}

export function UserProfile({
  className,
  showPreferences = false,
  showSettings = false,
}: UserProfileProps) {
  return (
    <UserProfileClient
      {...(className && { className })}
      showPreferences={showPreferences}
      showSettings={showSettings}
    />
  )
}

export default UserProfile
