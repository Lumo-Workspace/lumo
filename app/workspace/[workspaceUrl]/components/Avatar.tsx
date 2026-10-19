import { cn } from '@/lib/utils'

interface AvatarProps {
  src?: string
  initials?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES = {
  sm: 'size-5 text-caption font-semibold',
  md: 'size-7 text-caption font-semibold',
  lg: 'size-10 text-body-strong',
}

export function Avatar({ src, initials, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'rounded-full border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0',
        SIZE_CLASSES[size],
        className
      )}
    >
      {src ? (
        <img
          src={src}
          alt='avatar'
          className='w-full h-full object-cover'
          referrerPolicy='no-referrer'
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  )
}
