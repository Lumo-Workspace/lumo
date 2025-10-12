'use client'

import React from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Share, RefreshCw } from 'lucide-react'

interface BreadcrumbItem {
  id: string
  title: string
  type?:
    | 'workspace'
    | 'team'
    | 'project'
    | 'prd'
    | 'epic'
    | 'story'
    | 'task'
    | 'page'
}

interface UnifiedBreadcrumbProps {
  items: BreadcrumbItem[]
  onItemClick: (item: BreadcrumbItem) => void
  showActions?: boolean
  onShare?: () => void
  onUpdate?: () => void
}

export default function UnifiedBreadcrumb({
  items,
  onItemClick,
  showActions = true,
  onShare,
  onUpdate,
}: UnifiedBreadcrumbProps) {
  const handleItemClick = (item: BreadcrumbItem, isLast: boolean) => {
    if (!isLast) {
      onItemClick(item)
    }
  }

  return (
    <div className='h-12 border-b border-gray-200 flex items-center justify-between px-6 bg-white'>
      <Breadcrumb>
        <BreadcrumbList>
          {items.map((item, index) => {
            const isLast = index === items.length - 1

            return (
              <React.Fragment key={item.id}>
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage className='text-gray-900 font-medium'>
                      {item.title}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      onClick={() => handleItemClick(item, isLast)}
                      className='text-gray-600 hover:text-gray-900 cursor-pointer'
                    >
                      {item.title}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </React.Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      {showActions && (
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={onShare}
            className='text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          >
            <Share className='w-4 h-4 mr-1' />
            分享
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={onUpdate}
            className='text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          >
            <RefreshCw className='w-4 h-4 mr-1' />
            更新
          </Button>
        </div>
      )}
    </div>
  )
}
