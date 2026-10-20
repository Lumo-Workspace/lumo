'use client'

import {
  TAG_BADGE_COLORS,
  TAG_CHIP_CLASS,
  tagChipStyle,
  tagColorScheme,
} from './tag-colors'
import { Badge } from '@/components/ui/badge'

interface TagBadgeProps {
  tag: string
}

export function TagBadge({ tag }: TagBadgeProps) {
  return (
    <Badge
      variant='plain'
      size='xs'
      shape='square'
      className={TAG_CHIP_CLASS}
      style={tagChipStyle(tagColorScheme({ name: tag }, TAG_BADGE_COLORS))}
    >
      {tag}
    </Badge>
  )
}

interface TagListProps {
  tags: string[]
  max?: number
}

export function TagList({ tags, max = 3 }: TagListProps) {
  if (tags.length === 0) return null
  const visible = tags.slice(0, max)
  const overflow = tags.length - max

  return (
    <div className='flex items-center gap-1'>
      {visible.map(tag => (
        <TagBadge key={tag} tag={tag} />
      ))}
      {overflow > 0 && (
        <span className='text-caption text-muted-foreground'>+{overflow}</span>
      )}
    </div>
  )
}
