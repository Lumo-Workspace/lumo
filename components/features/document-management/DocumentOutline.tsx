'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TypographySmall } from '@/components/ui/typography'
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Hash,
} from 'lucide-react'

interface DocumentOutlineItem {
  id: string
  title: string
  level: number
  type: 'heading' | 'section'
}

interface DocumentOutlineProps {
  items: DocumentOutlineItem[]
  currentItemId?: string | undefined
  onItemClick?: (itemId: string) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export default function DocumentOutline({
  items,
  currentItemId,
  onItemClick,
  isCollapsed = false,
  onToggleCollapse,
}: DocumentOutlineProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  )

  const toggleSection = (itemId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const renderItem = (item: DocumentOutlineItem, index: number) => {
    const isActive = currentItemId === item.id
    const isExpanded = expandedSections.has(item.id)
    const hasChildren = items.some(
      (nextItem, nextIndex) =>
        nextIndex > index &&
        nextItem.level > item.level &&
        nextItem.level <= item.level + 1
    )

    const indentClass = `ml-${item.level * 4}`

    return (
      <div key={item.id} className={`${indentClass} mb-1`}>
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-gray-100 ${
            isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-700'
          }`}
          onClick={() => {
            if (hasChildren) {
              toggleSection(item.id)
            }
            onItemClick?.(item.id)
          }}
        >
          {hasChildren ? (
            <Button
              variant='ghost'
              size='sm'
              className='h-4 w-4 p-0 hover:bg-transparent'
              onClick={e => {
                e.stopPropagation()
                toggleSection(item.id)
              }}
            >
              {isExpanded ? (
                <ChevronDown className='h-3 w-3' />
              ) : (
                <ChevronRight className='h-3 w-3' />
              )}
            </Button>
          ) : (
            <div className='w-4 h-4' />
          )}

          {item.type === 'heading' ? (
            <Hash className='h-3 w-3 text-gray-400' />
          ) : (
            <FileText className='h-3 w-3 text-gray-400' />
          )}

          <TypographySmall className='flex-1 truncate'>
            {item.title}
          </TypographySmall>
        </div>

        {hasChildren && isExpanded && (
          <div className='ml-4'>
            {items
              .slice(index + 1)
              .filter(
                nextItem =>
                  nextItem.level > item.level &&
                  nextItem.level <= item.level + 1
              )
              .map((childItem, childIndex) =>
                renderItem(childItem, index + 1 + childIndex)
              )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='w-64 bg-white border-r border-gray-200 flex flex-col h-full'>
      {/* Header */}
      <div className='p-3 border-b border-gray-200'>
        <div className='flex items-center justify-between'>
          <TypographySmall className='font-semibold text-gray-900'>
            文档目录
          </TypographySmall>
          {onToggleCollapse && (
            <Button
              variant='ghost'
              size='sm'
              onClick={onToggleCollapse}
              className='h-6 w-6 p-0'
            >
              {isCollapsed ? (
                <ChevronsRight className='h-4 w-4' />
              ) : (
                <ChevronsLeft className='h-4 w-4' />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto p-3'>
        {items.length === 0 ? (
          <div className='text-center py-8'>
            <FileText className='h-8 w-8 text-gray-400 mx-auto mb-2' />
            <TypographySmall className='text-gray-500'>
              暂无目录内容
            </TypographySmall>
          </div>
        ) : (
          <div className='space-y-1'>
            {items
              .filter(item => item.level === 1)
              .map((item, index) => renderItem(item, index))}
          </div>
        )}
      </div>
    </div>
  )
}
