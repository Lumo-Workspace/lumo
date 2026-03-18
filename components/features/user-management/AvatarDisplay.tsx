'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/utils'

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
  size = 'md',
  className,
  showTooltip = false,
}: AvatarDisplayProps) {
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
      {avatarUrl && (
        <AvatarImage
          src={avatarUrl}
          alt={`${displayName || fallbackName || 'User'}'s avatar`}
          className="object-cover"
        />
      )}
      <AvatarFallback className={cn(textSizeClasses[size], 'font-semibold')}>
        {initials.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
