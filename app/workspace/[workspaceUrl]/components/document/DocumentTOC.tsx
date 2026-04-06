'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { FileText, Plus } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { ApiDocument } from '../../types'
import { cn } from '@/lib/utils'

interface TocHeading {
  id: string
  text: string
  level: number
}

interface DocumentTOCProps {
  editor: Editor | null
  childDocs: ApiDocument[]
  onChildClick: (doc: ApiDocument) => void
  onAddChild: () => void
}

export function DocumentTOC({
  editor,
  childDocs,
  onChildClick,
  onAddChild,
}: DocumentTOCProps) {
  const intl = useIntl()

  const headings = useMemo<TocHeading[]>(() => {
    if (!editor) return []
    const result: TocHeading[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const id = `heading-${pos}`
        result.push({
          id,
          text: node.textContent,
          level: node.attrs.level as number,
        })
      }
    })
    return result
  }, [editor, editor?.state.doc])

  return (
    <div className='w-52 shrink-0 border-r overflow-y-auto p-4 text-xs'>
      {headings.length > 0 && (
        <div className='mb-4'>
          <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2'>
            {intl.formatMessage({ id: 'documentEditor.tocTitle' })}
          </div>
          {headings.map(h => (
            <button
              key={h.id}
              type='button'
              className={cn(
                'block w-full text-left py-1 text-muted-foreground hover:text-foreground truncate transition-colors',
                h.level === 1 && 'font-medium text-foreground',
                h.level === 2 && 'pl-3',
                h.level === 3 && 'pl-6'
              )}
              onClick={() => {
                const el = document.getElementById(h.id)
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {h.text || 'Untitled'}
            </button>
          ))}
        </div>
      )}

      {childDocs.length > 0 && (
        <div>
          <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2'>
            {intl.formatMessage({ id: 'documentEditor.childDocs' })}
          </div>
          {childDocs.map(child => (
            <button
              key={child.id}
              type='button'
              className='flex items-center gap-1.5 w-full text-left py-1 text-muted-foreground hover:text-foreground truncate transition-colors'
              onClick={() => onChildClick(child)}
            >
              <FileText className='size-3 shrink-0' />
              <span className='truncate'>
                {child.emoji ? `${child.emoji} ` : ''}
                {child.title}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type='button'
        className='flex items-center gap-1.5 w-full text-left py-1 mt-2 text-muted-foreground hover:text-foreground transition-colors'
        onClick={onAddChild}
      >
        <Plus className='size-3' />
        <span>{intl.formatMessage({ id: 'documentEditor.addChildDoc' })}</span>
      </button>
    </div>
  )
}
