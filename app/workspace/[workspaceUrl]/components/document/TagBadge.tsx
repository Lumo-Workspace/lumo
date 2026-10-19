'use client'

import { TAG_BADGE_COLORS as TAG_COLORS } from './tag-colors'

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
    <span
      className='inline-flex items-center rounded-sm px-1.5 py-0.5 text-caption whitespace-nowrap'
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {tag}
    </span>
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
