'use client'

import React, { useState, useEffect } from 'react'
import { cn } from '../../../../lib/utils'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface Heading {
  id: string
  level: number
  text: string
  element: HTMLElement
}

interface TableOfContentsProps {
  className?: string
}

export function TableOfContents({ className }: TableOfContentsProps) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [expandedHeadings, setExpandedHeadings] = useState<Set<string>>(
    new Set()
  )

  useEffect(() => {
    const handleUpdate = (event: CustomEvent) => {
      setHeadings(event.detail.headings || [])
    }

    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i]
        if (heading && heading.element) {
          const elementTop = heading.element.offsetTop
          if (scrollPosition >= elementTop) {
            setActiveId(heading.id)
            break
          }
        }
      }
    }

    // 监听目录更新事件
    window.addEventListener(
      'tableOfContentsUpdate',
      handleUpdate as EventListener
    )

    // 监听滚动事件
    window.addEventListener('scroll', handleScroll)

    return () => {
      window.removeEventListener(
        'tableOfContentsUpdate',
        handleUpdate as EventListener
      )
      window.removeEventListener('scroll', handleScroll)
    }
  }, [headings])

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleHeadingExpansion = (headingId: string) => {
    setExpandedHeadings(prev => {
      const newSet = new Set(prev)
      if (newSet.has(headingId)) {
        newSet.delete(headingId)
      } else {
        newSet.add(headingId)
      }
      return newSet
    })
  }

  const isHeadingExpanded = (headingId: string) => {
    return expandedHeadings.has(headingId)
  }

  const hasChildren = (heading: Heading, index: number) => {
    // 检查是否有子标题（层级更高的标题）
    for (let i = index + 1; i < headings.length; i++) {
      const nextHeading = headings[i]
      if (nextHeading && nextHeading.level > heading.level) {
        return true
      }
      if (nextHeading && nextHeading.level <= heading.level) {
        break
      }
    }
    return false
  }

  const getVisibleHeadings = () => {
    const visible: Heading[] = []
    const stack: { heading: Heading; expanded: boolean }[] = []

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i]
      if (!heading) continue

      // 移除栈中层级大于等于当前标题的元素
      while (stack.length > 0) {
        const lastItem = stack[stack.length - 1]
        if (lastItem && lastItem.heading.level >= heading.level) {
          stack.pop()
        } else {
          break
        }
      }

      // 检查是否应该显示当前标题
      const shouldShow =
        stack.length === 0 || (stack[stack.length - 1]?.expanded ?? false)

      if (shouldShow) {
        visible.push(heading)
        const expanded = isHeadingExpanded(heading.id)
        stack.push({ heading, expanded })
      }
    }

    return visible
  }

  const getIndentClass = (level: number) => {
    switch (level) {
      case 1:
        return 'ml-0'
      case 2:
        return 'ml-3'
      case 3:
        return 'ml-6'
      case 4:
        return 'ml-9'
      case 5:
        return 'ml-12'
      case 6:
        return 'ml-15'
      default:
        return 'ml-0'
    }
  }

  // 没有标题时自动隐藏
  if (headings.length === 0) {
    return null
  }

  return (
    <div className={cn('sticky top-4', className)}>
      <nav className='space-y-1'>
        {getVisibleHeadings().map(heading => {
          const hasSubHeadings = hasChildren(
            heading,
            headings.findIndex(h => h.id === heading.id)
          )
          const isExpanded = isHeadingExpanded(heading.id)

          return (
            <div key={heading.id}>
              <div className='flex items-center'>
                {hasSubHeadings && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      toggleHeadingExpansion(heading.id)
                    }}
                    className='mr-1 p-1 hover:bg-gray-100 rounded transition-colors focus:outline-none'
                  >
                    {isExpanded ? (
                      <ChevronDown className='w-3 h-3' />
                    ) : (
                      <ChevronRight className='w-3 h-3' />
                    )}
                  </button>
                )}
                {!hasSubHeadings && <div className='w-5' />}

                <button
                  onClick={() => scrollToHeading(heading.id)}
                  className={cn(
                    'flex-1 text-left px-2 py-1 text-sm rounded transition-colors',
                    'hover:bg-gray-100 focus:bg-gray-100 focus:outline-none',
                    activeId === heading.id
                      ? 'text-blue-600 bg-blue-50 font-medium'
                      : 'text-gray-700 hover:text-gray-900',
                    getIndentClass(heading.level)
                  )}
                >
                  {heading.text}
                </button>
              </div>
            </div>
          )
        })}
      </nav>
    </div>
  )
}
