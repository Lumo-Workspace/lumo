'use client'

import type { CSSProperties } from 'react'
import { Bot } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils/getInitials'
import { cn } from '@/lib/utils'

/**
 * The one avatar for a person (LUM-1269). Image with initials fallback on the
 * shadcn/Radix Avatar, one size scale, one initials rule, one colour function.
 * Agents get `AgentAvatar` — same sizes, bot glyph instead of initials.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/** xs 20 · sm 24 · md 28 · lg 32 · xl 36 (px). */
export const AVATAR_SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'size-5',
  sm: 'size-6',
  md: 'size-7',
  lg: 'size-8',
  xl: 'size-9',
}

const INITIALS_TEXT_CLASS: Record<AvatarSize, string> = {
  xs: 'text-caption font-semibold',
  sm: 'text-caption font-semibold',
  md: 'text-caption font-semibold',
  lg: 'text-caption font-semibold',
  xl: 'text-body-strong',
}

const ICON_SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'size-3',
  sm: 'size-3',
  md: 'size-3.5',
  lg: 'size-4',
  xl: 'size-5',
}

/** Two caption-size initials don't fit a 20px circle (LUM-1244): xs shows one. */
export function avatarInitials(name: string, size: AvatarSize): string {
  return getInitials(name, size === 'xs' ? 1 : 2)
}

const AVATAR_COLORS = [
  'bg-status-in-review-subtle text-status-in-review-text',
  'bg-info-subtle text-info-text',
  'bg-success-subtle text-success-text',
  'bg-warning-subtle text-warning-text',
  'bg-danger-subtle text-danger-text',
]

/** Stable fallback colour per name (palette from LUM-1245). */
export function avatarColor(name: string): string {
  const code = (name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]!
}

// Wait briefly for a real image before flashing initials; with no image the
// fallback renders immediately (Radix reports `error` for an empty src).
const FALLBACK_DELAY_MS = 600

export interface MemberAvatarProps {
  name: string
  imageUrl?: string | null | undefined
  size?: AvatarSize
  className?: string
  /** e.g. stacking order in an overlapping group. */
  style?: CSSProperties
}

export function MemberAvatar({
  name,
  imageUrl,
  size = 'sm',
  className,
  style,
}: MemberAvatarProps) {
  const src = imageUrl || undefined
  return (
    <Avatar
      role='img'
      aria-label={name}
      className={cn(AVATAR_SIZE_CLASS[size], 'shrink-0', className)}
      style={style}
    >
      {src && (
        <AvatarImage
          src={src}
          alt=''
          className='object-cover'
          referrerPolicy='no-referrer'
        />
      )}
      <AvatarFallback
        aria-hidden
        {...(src ? { delayMs: FALLBACK_DELAY_MS } : {})}
        className={cn(avatarColor(name), INITIALS_TEXT_CLASS[size])}
      >
        {avatarInitials(name, size)}
      </AvatarFallback>
    </Avatar>
  )
}

export function AgentAvatar({
  name,
  size = 'sm',
  className,
}: Omit<MemberAvatarProps, 'imageUrl' | 'style'>) {
  return (
    <span
      role='img'
      aria-label={name}
      className={cn(
        AVATAR_SIZE_CLASS[size],
        'flex shrink-0 items-center justify-center rounded-full bg-info-subtle',
        className
      )}
    >
      <Bot
        aria-hidden
        className={cn(ICON_SIZE_CLASS[size], 'text-info-text')}
      />
    </span>
  )
}
