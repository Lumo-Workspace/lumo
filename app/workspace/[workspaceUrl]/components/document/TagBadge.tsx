'use client'

const TAG_COLORS = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: '#166534' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#e0e7ff', text: '#3730a3' },
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#ffedd5', text: '#9a3412' },
  { bg: '#ccfbf1', text: '#115e59' },
  { bg: '#fee2e2', text: '#991b1b' },
]

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
      className='inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap'
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
        <span className='text-[10px] text-muted-foreground'>+{overflow}</span>
      )}
    </div>
  )
}
