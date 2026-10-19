import { AgentAvatar, MemberAvatar } from '@/components/MemberAvatar'

interface CommentAvatarProps {
  isAgent: boolean
  name: string
  imageUrl: string | undefined
  size?: 'sm' | 'md'
}

/** Comment / activity author avatar: agent glyph or member avatar (LUM-1269). */
export function CommentAvatar({
  isAgent,
  name,
  imageUrl,
  size = 'md',
}: CommentAvatarProps) {
  return isAgent ? (
    <AgentAvatar name={name} size={size} className='mt-0.5' />
  ) : (
    <MemberAvatar
      name={name}
      imageUrl={imageUrl}
      size={size}
      className='mt-0.5'
    />
  )
}
