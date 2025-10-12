/**
 * Team Member List Component with Real-time Updates
 * Displays team members with real-time profile updates via SSE
 */

'use client'

import React from 'react'
import { useProfileUpdates } from '@/hooks/use-profile-updates'
import { AvatarDisplay } from '@/components/features/user-management/AvatarDisplay'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TeamMember {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
  email?: string | null
  isOnline?: boolean
  lastSeen?: Date
}

interface TeamMemberListProps {
  members: TeamMember[]
  className?: string
  showConnectionStatus?: boolean
  onMemberClick?: (member: TeamMember) => void
}

export function TeamMemberList({
  members,
  className,
  showConnectionStatus = true,
  onMemberClick,
}: TeamMemberListProps) {
  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className='flex items-center justify-between'>
          Team Members
          {showConnectionStatus && <ConnectionStatus />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='space-y-3'>
          {members.map(member => (
            <TeamMemberItem
              key={member.id}
              member={member}
              onClick={onMemberClick}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

interface TeamMemberItemProps {
  member: TeamMember
  onClick?: ((member: TeamMember) => void) | undefined
}

function TeamMemberItem({ member, onClick }: TeamMemberItemProps) {
  const { profile, isConnected, lastUpdate, error, reconnect } =
    useProfileUpdates(member.id)

  // Use real-time profile data if available, otherwise fall back to member data
  const displayName =
    profile?.displayName || member.displayName || 'Unknown User'
  const avatarUrl = profile?.avatarUrl || member.avatarUrl
  const email = profile?.email || member.email

  return (
    <div
      className={cn(
        'flex items-center space-x-3 p-3 rounded-lg border transition-colors',
        'hover:bg-muted/50 cursor-pointer',
        error && 'border-destructive/50 bg-destructive/5'
      )}
      onClick={() => onClick?.(member)}
    >
      {/* Avatar with real-time updates */}
      <div className='relative'>
        <AvatarDisplay
          avatarUrl={avatarUrl}
          displayName={displayName}
          fallbackName={email}
          size='md'
          className='ring-2 ring-background'
        />

        {/* Connection status indicator */}
        <div className='absolute -bottom-1 -right-1'>
          <div
            className={cn(
              'w-3 h-3 rounded-full border-2 border-background',
              isConnected ? 'bg-green-500' : 'bg-gray-400'
            )}
          />
        </div>
      </div>

      {/* Member info */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center space-x-2'>
          <p className='text-sm font-medium truncate'>{displayName}</p>

          {/* Real-time update indicator */}
          {lastUpdate && (
            <Badge variant='secondary' className='text-xs'>
              Live
            </Badge>
          )}
        </div>

        <p className='text-xs text-muted-foreground truncate'>{email}</p>

        {/* Last update time */}
        {lastUpdate && (
          <p className='text-xs text-muted-foreground'>
            Updated {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Connection status and actions */}
      <div className='flex items-center space-x-2'>
        {error && (
          <Button
            variant='ghost'
            size='sm'
            onClick={e => {
              e.stopPropagation()
              reconnect()
            }}
            className='h-8 w-8 p-0'
          >
            <RefreshCw className='h-4 w-4' />
          </Button>
        )}

        {true && (
          <div className='flex items-center space-x-1'>
            {isConnected ? (
              <Wifi className='h-4 w-4 text-green-500' />
            ) : (
              <WifiOff className='h-4 w-4 text-gray-400' />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectionStatus() {
  // This could be a global connection status or per-user status
  // For now, we'll show a simple indicator
  return (
    <div className='flex items-center space-x-2'>
      <div className='flex items-center space-x-1'>
        <Wifi className='h-4 w-4 text-green-500' />
        <span className='text-sm text-muted-foreground'>Live Updates</span>
      </div>
    </div>
  )
}

// Example usage component
export function TeamMemberListDemo() {
  const [members] = React.useState<TeamMember[]>([
    {
      id: 'user-1',
      displayName: 'Alice Johnson',
      email: 'alice@example.com',
      isOnline: true,
    },
    {
      id: 'user-2',
      displayName: 'Bob Smith',
      email: 'bob@example.com',
      isOnline: false,
    },
    {
      id: 'user-3',
      displayName: 'Charlie Brown',
      email: 'charlie@example.com',
      isOnline: true,
    },
  ])

  const handleMemberClick = (member: TeamMember) => {
    console.log('Clicked member:', member)
  }

  return (
    <div className='max-w-md mx-auto'>
      <TeamMemberList
        members={members}
        onMemberClick={handleMemberClick}
        showConnectionStatus={true}
      />
    </div>
  )
}
