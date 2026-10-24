'use client'

import { useIntl } from 'react-intl'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for the Sprint detail page while the sprint loads — mirrors the
 * live layout (header, four stage cards, awaiting queue, task table) so the
 * page doesn't jump when data lands. The loading label stays for screen
 * readers only.
 */
export function SprintDetailSkeleton() {
  const intl = useIntl()
  return (
    <div
      role='status'
      aria-busy='true'
      className='mx-auto flex w-full max-w-420 flex-col gap-5 px-4 pt-4 pb-8 sm:gap-6 sm:px-8 sm:pt-6 sm:pb-12'
    >
      <span className='sr-only'>
        {intl.formatMessage({ id: 'sprints.detail.loading' })}
      </span>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-7 w-48' />
          <Skeleton className='h-4 w-64' />
        </div>
        <div className='flex gap-2'>
          <Skeleton className='h-9 w-28' />
          <Skeleton className='h-9 w-24' />
        </div>
      </div>
      <div className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'>
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className='h-32' />
        ))}
      </div>
      <Skeleton className='h-48' />
      <Skeleton className='h-64' />
    </div>
  )
}

/** Inline placeholder for the breadcrumb's current-page label. */
export function SprintBreadcrumbSkeleton() {
  return <Skeleton className='h-4 w-24' />
}
