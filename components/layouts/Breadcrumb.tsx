'use client'

import React from 'react'
import UnifiedBreadcrumb from './UnifiedBreadcrumb'

interface Page {
  id: string
  title: string
  parentId?: string
  children: string[]
}

interface BreadcrumbProps {
  pages: Record<string, Page>
  currentPageId: string
  onPageClick: (pageId: string) => void
}

export default function Breadcrumb({
  pages,
  currentPageId,
  onPageClick,
}: BreadcrumbProps) {
  const getBreadcrumbPath = (pageId: string): Page[] => {
    const path: Page[] = []
    let currentPage = pages[pageId]

    while (currentPage) {
      path.unshift(currentPage)
      if (currentPage.parentId) {
        currentPage = pages[currentPage.parentId]
      } else {
        break
      }
    }

    return path
  }

  const path = getBreadcrumbPath(currentPageId)

  // 转换为统一面包屑格式
  const breadcrumbItems = path.map(page => ({
    id: page.id,
    title: page.title,
    type: 'page' as const,
  }))

  const handleItemClick = (item: {
    id: string
    title: string
    type?: string
  }) => {
    onPageClick(item.id)
  }

  return (
    <UnifiedBreadcrumb
      items={breadcrumbItems}
      onItemClick={handleItemClick}
      showActions={true}
      onShare={() => console.log('分享页面')}
      onUpdate={() => console.log('更新页面')}
    />
  )
}
