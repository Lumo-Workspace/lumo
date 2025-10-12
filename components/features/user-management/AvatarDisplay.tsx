'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarDisplayProps } from '@/lib/utils/default-avatar'
import { cn } from '@/lib/utils'

interface AvatarDisplayProps {
  avatarUrl?: string | null | undefined
  displayName?: string | null | undefined
  fallbackName?: string | null | undefined
  userId?: string | undefined
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string | undefined
  showTooltip?: boolean
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-20 w-20',
}

const textSizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-2xl',
}

export function AvatarDisplay({
  avatarUrl,
  displayName,
  fallbackName,
  userId,
  size = 'md',
  className,
  showTooltip = false,
}: AvatarDisplayProps) {
  const avatarProps = getAvatarDisplayProps(
    avatarUrl,
    displayName,
    fallbackName,
    userId
  )
  const initials = displayName?.charAt(0) || fallbackName?.charAt(0) || 'U'

  return (
    <Avatar
      className={cn(sizeClasses[size], className)}
      title={
        showTooltip
          ? `${displayName || fallbackName || 'User'}'s avatar`
          : undefined
      }
    >
      <AvatarImage
        src={avatarProps.src}
        alt={avatarProps.alt}
        className='object-cover'
      />
      <AvatarFallback className={cn(textSizeClasses[size], 'font-semibold')}>
        {initials.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

interface AvatarListProps {
  users: Array<{
    id: string
    displayName?: string | null
    avatarUrl?: string | null
    email?: string | null
  }>
  size?: 'sm' | 'md' | 'lg' | 'xl'
  maxVisible?: number
  className?: string
}

export function AvatarList({
  users,
  size = 'md',
  maxVisible = 5,
  className,
}: AvatarListProps) {
  const visibleUsers = users.slice(0, maxVisible)
  const remainingCount = Math.max(0, users.length - maxVisible)

  return (
    <div className={cn('flex -space-x-2', className)}>
      {visibleUsers.map(user => (
        <div key={user.id} className='relative'>
          <AvatarDisplay
            avatarUrl={user.avatarUrl}
            displayName={user.displayName}
            fallbackName={user.email}
            userId={user.id}
            size={size}
            showTooltip
            className='ring-2 ring-white'
          />
        </div>
      ))}

      {remainingCount > 0 && (
        <div className='relative'>
          <Avatar
            className={cn(
              sizeClasses[size],
              'ring-2 ring-white bg-gray-100 flex items-center justify-center'
            )}
          >
            <span
              className={cn(
                textSizeClasses[size],
                'font-semibold text-gray-600'
              )}
            >
              +{remainingCount}
            </span>
          </Avatar>
        </div>
      )}
    </div>
  )
}

interface AvatarWithNameProps {
  avatarUrl?: string | null
  displayName?: string | null
  fallbackName?: string | null
  userId?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showName?: boolean
  namePosition?: 'right' | 'below'
  className?: string
}

export function AvatarWithName({
  avatarUrl,
  displayName,
  fallbackName,
  userId,
  size = 'md',
  showName = true,
  namePosition = 'right',
  className,
}: AvatarWithNameProps) {
  const name = displayName || fallbackName || 'User'

  if (!showName) {
    return (
      <AvatarDisplay
        avatarUrl={avatarUrl}
        displayName={displayName}
        fallbackName={fallbackName}
        userId={userId}
        size={size}
        className={className}
      />
    )
  }

  if (namePosition === 'below') {
    return (
      <div className={cn('flex flex-col items-center space-y-2', className)}>
        <AvatarDisplay
          avatarUrl={avatarUrl}
          displayName={displayName}
          fallbackName={fallbackName}
          userId={userId}
          size={size}
        />
        <span className='text-sm font-medium text-gray-900 truncate max-w-24'>
          {name}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center space-x-3', className)}>
      <AvatarDisplay
        avatarUrl={avatarUrl}
        displayName={displayName}
        fallbackName={fallbackName}
        userId={userId}
        size={size}
      />
      <span className='text-sm font-medium text-gray-900 truncate'>{name}</span>
    </div>
  )
}
