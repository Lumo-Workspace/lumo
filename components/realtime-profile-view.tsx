/**
 * Real-time Profile View Component
 * Displays user profile with real-time updates via SSE
 */

'use client'

import React from 'react'
import { useProfileUpdates } from '@/hooks/use-profile-updates'
import { AvatarDisplay } from './avatar-display'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  User,
  Mail,
  Clock,
  CheckCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface RealtimeProfileViewProps {
  userId: string
  className?: string
  showConnectionStatus?: boolean
  showLastUpdate?: boolean
}

export function RealtimeProfileView({
  userId,
  className,
  showConnectionStatus = true,
  showLastUpdate = true,
}: RealtimeProfileViewProps) {
  const { profile, isConnected, lastUpdate, error, reconnect } =
    useProfileUpdates(userId)

  if (error && !profile) {
    return (
      <Card className={cn('w-full', className)}>
        <CardContent className='flex flex-col items-center justify-center p-8'>
          <AlertCircle className='h-12 w-12 text-destructive mb-4' />
          <h3 className='text-lg font-semibold mb-2'>Connection Error</h3>
          <p className='text-sm text-muted-foreground text-center mb-4'>
            {error}
          </p>
          <Button onClick={reconnect} variant='outline'>
            <RefreshCw className='h-4 w-4 mr-2' />
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center space-x-2'>
            <User className='h-5 w-5' />
            <span>Profile</span>
            {isConnected && (
              <Badge variant='secondary' className='text-xs'>
                <CheckCircle className='h-3 w-3 mr-1' />
                Live
              </Badge>
            )}
          </CardTitle>

          {showConnectionStatus && (
            <ConnectionStatusIndicator
              isConnected={isConnected}
              error={error}
              onReconnect={reconnect}
            />
          )}
        </div>
      </CardHeader>

      <CardContent>
        {!profile ? (
          <ProfileSkeleton />
        ) : (
          <ProfileContent
            profile={profile}
            lastUpdate={lastUpdate}
            showLastUpdate={showLastUpdate}
          />
        )}
      </CardContent>
    </Card>
  )
}

interface ProfileContentProps {
  profile: {
    id: string
    displayName?: string | null
    avatarUrl?: string | null
    email?: string | null
    createdAt: Date
    updatedAt: Date
  }
  lastUpdate: Date | null
  showLastUpdate: boolean
}

function ProfileContent({
  profile,
  lastUpdate,
  showLastUpdate,
}: ProfileContentProps) {
  return (
    <div className='space-y-6'>
      {/* Avatar and Basic Info */}
      <div className='flex items-center space-x-4'>
        <AvatarDisplay
          avatarUrl={profile.avatarUrl}
          displayName={profile.displayName}
          fallbackName={profile.email}
          size='lg'
          className='ring-4 ring-background'
        />

        <div className='flex-1'>
          <h2 className='text-2xl font-bold'>
            {profile.displayName || 'Unknown User'}
          </h2>
          {profile.email && (
            <div className='flex items-center space-x-2 text-muted-foreground'>
              <Mail className='h-4 w-4' />
              <span className='text-sm'>{profile.email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Profile Details */}
      <div className='space-y-4'>
        <div className='grid grid-cols-2 gap-4 text-sm'>
          <div>
            <span className='font-medium text-muted-foreground'>User ID:</span>
            <p className='font-mono text-xs'>{profile.id}</p>
          </div>

          <div>
            <span className='font-medium text-muted-foreground'>
              Member Since:
            </span>
            <p>{new Date(profile.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Real-time Update Info */}
        {showLastUpdate && lastUpdate && (
          <div className='flex items-center space-x-2 text-sm text-muted-foreground'>
            <Clock className='h-4 w-4' />
            <span>Last updated: {lastUpdate.toLocaleTimeString()}</span>
          </div>
        )}

        {/* Profile Update Status */}
        <div className='flex items-center space-x-2'>
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              lastUpdate ? 'bg-green-500' : 'bg-gray-400'
            )}
          />
          <span className='text-sm text-muted-foreground'>
            {lastUpdate ? 'Real-time updates active' : 'Waiting for updates'}
          </span>
        </div>
      </div>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className='space-y-6'>
      <div className='flex items-center space-x-4'>
        <Skeleton className='h-16 w-16 rounded-full' />
        <div className='flex-1 space-y-2'>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='h-4 w-32' />
        </div>
      </div>

      <div className='space-y-4'>
        <div className='grid grid-cols-2 gap-4'>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-16' />
            <Skeleton className='h-3 w-24' />
          </div>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-3 w-20' />
          </div>
        </div>
      </div>
    </div>
  )
}

interface ConnectionStatusIndicatorProps {
  isConnected: boolean
  error: string | null
  onReconnect: () => void
}

function ConnectionStatusIndicator({
  isConnected,
  error,
  onReconnect,
}: ConnectionStatusIndicatorProps) {
  return (
    <div className='flex items-center space-x-2'>
      {error ? (
        <Button
          variant='ghost'
          size='sm'
          onClick={onReconnect}
          className='h-8 w-8 p-0'
        >
          <RefreshCw className='h-4 w-4' />
        </Button>
      ) : (
        <div className='flex items-center space-x-1'>
          {isConnected ? (
            <Wifi className='h-4 w-4 text-green-500' />
          ) : (
            <WifiOff className='h-4 w-4 text-gray-400' />
          )}
        </div>
      )}
    </div>
  )
}

// Example usage component
export function RealtimeProfileViewDemo() {
  return (
    <div className='max-w-md mx-auto'>
      <RealtimeProfileView
        userId='user-123'
        showConnectionStatus={true}
        showLastUpdate={true}
      />
    </div>
  )
}
