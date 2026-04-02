import React from 'react'

import { cn } from '@/lib/utils'

import { Badge } from './badge'

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  image: React.ComponentType<React.SVGProps<SVGSVGElement>>
  name: string
  version?: string
  width?: number
  height?: number
  showName?: boolean
  badge?: string
}

export default function Logo({
  className,
  image: SvgImage,
  name,
  version,
  width = 48,
  height = 48,
  showName = true,
  badge,
  ...props
}: LogoProps) {
  return (
    <div
      data-slot='logo'
      className={cn(
        'group flex items-center gap-3 text-xl font-medium',
        className
      )}
      {...props}
    >
      <SvgImage
        width={width}
        height={height}
        aria-hidden='true'
        className='max-h-full max-w-full opacity-50 grayscale transition-all duration-300 group-hover:opacity-100 group-hover:grayscale-0'
      />
      <span className={cn(!showName && 'sr-only')}>{name}</span>
      {version && <span className='text-muted-foreground'>{version}</span>}
      {badge && (
        <Badge variant='brand' size='sm'>
          {badge}
        </Badge>
      )}
    </div>
  )
}
