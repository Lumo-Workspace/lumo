'use client'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * RichTextEditorLoader - Loading component for RichTextEditor
 * Follows React 19 patterns for Suspense boundaries
 */
export function RichTextEditorLoader() {
  return (
    <div className='flex h-screen bg-gray-50 text-gray-800 items-center justify-center'>
      <div className='text-center space-y-4'>
        <Skeleton className='h-16 w-16 rounded-full mx-auto' />
        <Skeleton className='h-4 w-48 mx-auto' />
        <Skeleton className='h-3 w-64 mx-auto' />
      </div>
    </div>
  )
}
