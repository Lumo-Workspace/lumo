'use client'

import { type RefObject } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useTableInsertHandles } from './useTableInsertHandles'

interface Props {
  editor: Editor | null
  /** Positioned (relative) container the marker coords are measured against. */
  containerRef: RefObject<HTMLElement | null>
}

export function TableInsertHandles({ editor, containerRef }: Props) {
  const intl = useIntl()
  const { marker, onInsert } = useTableInsertHandles(editor, containerRef)
  if (!marker) return null

  const isCol = marker.axis === 'col'
  const label = intl.formatMessage({
    id: isCol ? 'table.insertColumnHere' : 'table.insertRowHere',
  })

  return (
    <>
      <span
        className='table-insert-line'
        style={
          isCol
            ? {
                left: marker.left,
                top: marker.top,
                width: 2,
                height: marker.lineLength,
                transform: 'translateX(-50%)',
              }
            : {
                left: marker.left,
                top: marker.top,
                width: marker.lineLength,
                height: 2,
                transform: 'translateY(-50%)',
              }
        }
      />
      <button
        type='button'
        className='table-insert-handle'
        style={{ left: marker.left, top: marker.top }}
        aria-label={label}
        onClick={onInsert}
      >
        <Plus size={12} />
      </button>
    </>
  )
}
