'use client'

import type React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Folder,
  FolderOpen,
} from 'lucide-react'

interface Page {
  id: string
  title: string
  parentId?: string
  children: string[]
  blocks: any[]
  isExpanded?: boolean
}

interface PageTreeProps {
  pages: Record<string, Page>
  currentPageId: string
  currentView: 'editor' | 'inbox' | 'shared' | 'teams'
  editingPageId: string | null
  editingTitle: string
  onPageClick: (pageId: string) => void
  onToggleExpansion: (pageId: string) => void
  onCreateNewPage: (parentId?: string) => void
  onContextMenu: (e: React.MouseEvent, pageId: string) => void
  onTitleChange: (title: string) => void
  onTitleSubmit: (pageId: string) => void
  onTitleCancel: () => void
}

export default function PageTree({
  pages,
  currentPageId,
  currentView,
  editingPageId,
  editingTitle,
  onPageClick,
  onToggleExpansion,
  onCreateNewPage,
  onContextMenu,
  onTitleChange,
  onTitleSubmit,
  onTitleCancel,
}: PageTreeProps) {
  const renderPageTree = (pageId: string, level = 0) => {
    const page = pages[pageId]
    if (!page) return null

    const hasChildren = page.children.length > 0
    const isCurrentPage = currentView === 'editor' && currentPageId === pageId
    const isEditing = editingPageId === pageId

    return (
      <div key={pageId} className='my-0.5'>
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer -mx-2 ${
            isCurrentPage ? 'bg-blue-100' : ''
          }`}
          onContextMenu={e => onContextMenu(e, pageId)}
        >
          <div
            style={{ paddingLeft: `${level * 12}px` }}
            className='flex items-center gap-1'
          >
            {hasChildren && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  onToggleExpansion(pageId)
                }}
                className='p-0.5 rounded'
              >
                {page.isExpanded ? (
                  <ChevronDown className='w-4 h-4' />
                ) : (
                  <ChevronRight className='w-4 h-4' />
                )}
              </button>
            )}
            {!hasChildren && <div className='w-5' />}
            {hasChildren ? (
              page.isExpanded ? (
                <FolderOpen
                  className='w-4 h-4 flex-shrink-0 text-gray-600'
                  fill='none'
                />
              ) : (
                <Folder
                  className='w-4 h-4 flex-shrink-0 text-gray-600'
                  fill='none'
                />
              )
            ) : (
              <FileText
                className={`w-4 h-4 flex-shrink-0 ${isCurrentPage ? 'text-blue-600' : 'text-gray-600'}`}
                fill={isCurrentPage ? 'currentColor' : 'none'}
              />
            )}
          </div>

          <div
            onClick={() => onPageClick(pageId)}
            className='flex items-center justify-between flex-1 min-w-0'
          >
            {isEditing ? (
              <Input
                value={editingTitle}
                onChange={e => onTitleChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onTitleSubmit(pageId)
                  } else if (e.key === 'Escape') {
                    onTitleCancel()
                  }
                }}
                onBlur={() => onTitleSubmit(pageId)}
                className='h-6 text-sm px-1 py-0'
                autoFocus
              />
            ) : (
              <span className='text-sm truncate'>{page.title}</span>
            )}

            <Button
              variant='ghost'
              size='sm'
              className='w-4 h-4 p-0 opacity-0 group-hover:opacity-100'
              onClick={e => {
                e.stopPropagation()
                onCreateNewPage(pageId)
              }}
            >
              <Plus className='w-3 h-3' />
            </Button>
          </div>
        </div>

        {hasChildren && page.isExpanded && (
          <div>
            {page.children.map(childId => renderPageTree(childId, level + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootPages = Object.values(pages).filter(page => !page.parentId)

  return (
    <div className='space-y-0'>
      <div className='group'>
        {rootPages.map(page => renderPageTree(page.id))}
      </div>
    </div>
  )
}
