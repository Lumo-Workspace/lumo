'use client'

import { TAG_BADGE_COLORS as TAG_COLORS } from './tag-colors'
import { Badge } from '@/components/ui/badge'

function getTagColor(tag: string): { bg: string; text: string } {
  const hash = tag.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return TAG_COLORS[hash % TAG_COLORS.length] ?? TAG_COLORS[0]!
}

interface TagBadgeProps {
  tag: string
}

export function TagBadge({ tag }: TagBadgeProps) {
  const color = getTagColor(tag)
  return (
    <Badge
      variant='plain'
      size='xs'
      shape='square'
      style={{ backgroundColor: color.bg, color: color.text }}
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
