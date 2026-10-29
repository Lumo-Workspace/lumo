'use client'

import type { ReactNode } from 'react'
import { LoadingState } from '../AsyncContent'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'
import { SkeletonLine } from '../skeletons/SkeletonLine'

/** LUM-1339 — the frame every settings page shares: scroll box, title, subtitle. */
export function SettingsPageLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1
          className={`text-heading text-foreground ${subtitle ? 'mb-1' : 'mb-8'}`}
        >
          {title}
        </h1>
        {subtitle && (
          <p className='text-body text-muted-foreground mb-8'>{subtitle}</p>
        )}
        {children}
      </div>
    </div>
  )
}

/** The skeleton an OWNER-only settings page shows while its row loads. */
export function SettingsPageSkeleton() {
  return (
    <LoadingState className='h-full overflow-y-auto'>
      <div aria-hidden className='max-w-2xl mx-auto px-6 py-8'>
        <SkeletonLine
          boxHeight='32px'
          barHeight='h-6'
          width='40%'
          className='mb-8'
        />
        <RowListSkeleton
          rows={4}
          subtitle
          divided
          rowClassName='px-5 py-4'
          className='rounded-lg border border-border'
        />
      </div>
    </LoadingState>
  )
}
