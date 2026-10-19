import { Bot } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface CommentAvatarProps {
  isAgent: boolean
  imageUrl: string | undefined
  initials: string
  size?: 'sm' | 'md'
}

export function CommentAvatar({
  isAgent,
  imageUrl,
  initials,
  size = 'md',
}: CommentAvatarProps) {
  const sizeClass = size === 'sm' ? 'size-6' : 'size-7'
  const iconSize = size === 'sm' ? 'size-3' : 'size-3.5'

  if (isAgent) {
    return (
      <div
        className={`${sizeClass} shrink-0 mt-0.5 rounded-full bg-info-subtle flex items-center justify-center`}
      >
        <Bot className={`${iconSize} text-info-text`} />
      </div>
    )
  }

  return (
    <Avatar className={`${sizeClass} shrink-0 mt-0.5`}>
      <AvatarImage src={imageUrl} />
      <AvatarFallback className='text-[10px]'>{initials}</AvatarFallback>
    </Avatar>
  )
}
