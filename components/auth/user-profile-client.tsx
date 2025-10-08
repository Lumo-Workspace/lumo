'use client'

import React from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent } from '@/components/ui/card'
import { UserProfileContent } from './user-profile-content'

interface UserProfileClientProps {
  className?: string
  showPreferences?: boolean
  showSettings?: boolean
}

export function UserProfileClient({
  className,
  showPreferences = false,
  showSettings = false,
}: UserProfileClientProps) {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <Card className={className}>
        <CardContent className='p-6'>
          <div className='flex items-center space-x-4'>
            <div className='animate-pulse rounded-full bg-gray-300 h-12 w-12'></div>
            <div className='space-y-2'>
              <div className='animate-pulse bg-gray-300 h-4 w-32 rounded'></div>
              <div className='animate-pulse bg-gray-300 h-3 w-24 rounded'></div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <Card className={className}>
        <CardContent className='p-6'>
          <p className='text-muted-foreground'>
            Please sign in to view your profile.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <UserProfileContent
      session={session}
      className={className}
      showPreferences={showPreferences}
      showSettings={showSettings}
    />
  )
}
