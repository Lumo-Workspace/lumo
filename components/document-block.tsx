'use client'

import type React from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import TaskWidgetComponent from '@/components/task-widget'
import type { DocumentBlock, TaskWidget } from '@/hooks/use-document-blocks'

interface DocumentBlockProps {
  block: DocumentBlock
  index: number
  onContentChange: (blockId: string, content: string) => void
  onFocus: (blockId: string) => void
  onKeyDown: (e: React.KeyboardEvent, blockId: string) => void
  onAddTask: (afterBlockId: string) => void
  onTaskStatusChange: (taskId: string, newStatus: TaskWidget['status']) => void
  onTaskEdit: (taskId: string) => void
  onTaskDelete: (taskId: string) => void
}

export function DocumentBlock({
  block,
  index,
  onContentChange,
  onFocus,
  onKeyDown,
  onAddTask,
  onTaskStatusChange,
  onTaskEdit,
  onTaskDelete,
}: DocumentBlockProps) {
  if (block.type === 'text') {
    return (
      <div className='mb-4 group'>
        <div className='relative'>
          <div
            contentEditable
            suppressContentEditableWarning
            className={cn(
              'min-h-[1.5rem] outline-none focus:bg-blue-50/30 rounded px-2 py-1 transition-colors',
              'prose prose-sm max-w-none',
              // shadcn typography styles
              '[&_h1]:scroll-m-20 [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:text-balance [&_h1]:mb-4',
              '[&_h2]:scroll-m-20 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:transition-colors [&_h2]:first:mt-0 [&_h2]:mb-3',
              '[&_h3]:scroll-m-20 [&_h3]:text-2xl [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mb-2',
              '[&_h4]:scroll-m-20 [&_h4]:text-xl [&_h4]:font-semibold [&_h4]:tracking-tight [&_h4]:mb-2',
              '[&_h5]:scroll-m-20 [&_h5]:text-lg [&_h5]:font-semibold [&_h5]:tracking-tight [&_h5]:mb-2',
              '[&_h6]:scroll-m-20 [&_h6]:text-base [&_h6]:font-semibold [&_h6]:tracking-tight [&_h6]:mb-2',
              '[&_p]:leading-7 [&_p:not(:first-child)]:mt-6',
              '[&_ul]:my-6 [&_ul]:ml-6 [&_ul]:list-disc [&_ul>li]:mt-2',
              '[&_ol]:my-6 [&_ol]:ml-6 [&_ol]:list-decimal [&_ol>li]:mt-2',
              '[&_strong]:font-semibold',
              '[&_em]:italic',
              '[&_code]:relative [&_code]:rounded [&_code]:bg-muted [&_code]:px-[0.3rem] [&_code]:py-[0.2rem] [&_code]:font-mono [&_code]:text-sm [&_code]:font-semibold',
              '[&_blockquote]:mt-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-6 [&_blockquote]:italic'
            )}
            onInput={e => onContentChange(block.id, e.currentTarget.innerHTML)}
            onFocus={() => onFocus(block.id)}
            onKeyDown={e => onKeyDown(e, block.id)}
            dangerouslySetInnerHTML={{ __html: block.content }}
            data-placeholder={
              index === 0
                ? 'Start writing your document...'
                : 'Continue writing...'
            }
          />

          {/* Block Actions */}
          <div className='absolute -left-12 top-1 opacity-0 group-hover:opacity-100 transition-opacity'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => onAddTask(block.id)}
              className='w-8 h-8 p-0 text-gray-400 hover:text-gray-600'
              title='Insert task'
            >
              +
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='my-6'>
      <TaskWidgetComponent
        task={block.task!}
        context={{
          isEmbedded: true,
          canEdit: true,
          showFullDetails: false,
        }}
        onStatusChange={onTaskStatusChange}
        onEdit={onTaskEdit}
        onDelete={onTaskDelete}
      />
    </div>
  )
}
