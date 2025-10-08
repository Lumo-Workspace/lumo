'use client'

import React from 'react'
import { Session } from 'next-auth'
import { UserProfileContent } from './user-profile-content'
import { UserProfileClient } from './user-profile-client'

interface UserProfileProps {
  className?: string
  showPreferences?: boolean
  showSettings?: boolean
  session?: Session | null // Optional session prop for server-side usage
}

export function UserProfile({
  className,
  showPreferences = false,
  showSettings = false,
  session: sessionProp,
}: UserProfileProps) {
  // If session is provided as prop (server-side), use the content component directly
  if (sessionProp !== undefined) {
    return (
      <UserProfileContent
        session={sessionProp}
        className={className}
        showPreferences={showPreferences}
        showSettings={showSettings}
      />
    )
  }

  // Otherwise, use the client-side version with useSession hook
  return (
    <UserProfileClient
      className={className}
      showPreferences={showPreferences}
      showSettings={showSettings}
    />
  )
}

export default UserProfile
