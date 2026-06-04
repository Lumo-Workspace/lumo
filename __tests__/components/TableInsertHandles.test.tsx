/** @jest-environment jsdom */
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { InsertMarker } from '@/lib/editor/table/insert-command'

const messages: Record<string, string> = {
  'table.insertColumnHere': 'Insert column',
  'table.insertRowHere': 'Insert row',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

// Drive the component by controlling the hook's return value.
const onInsert = jest.fn()
let hookMarker: InsertMarker | null = null
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/table/useTableInsertHandles',
  () => ({
    useTableInsertHandles: () => ({ marker: hookMarker, onInsert }),
  })
)

import { TableInsertHandles } from '@/app/workspace/[workspaceUrl]/components/table/TableInsertHandles'

const editor = {} as unknown as Editor
const containerRef = createRef<HTMLElement>()

function renderHandles() {
  return render(<TableInsertHandles editor={editor} containerRef={containerRef} />)
}

describe('TableInsertHandles', () => {
  beforeEach(() => {
    onInsert.mockClear()
    hookMarker = null
  })

  it('renders nothing when there is no marker', () => {
    const { container } = renderHandles()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an insert-column button and fires onInsert on click', () => {
    hookMarker = {
      axis: 'col',
      side: 'after',
      anchorIndex: 1,
      left: 120,
      top: 0,
      lineLength: 80,
      cellPoint: { x: 50, y: 20 },
    }
    renderHandles()
    const btn = screen.getByRole('button', { name: 'Insert column' })
    fireEvent.click(btn)
    expect(onInsert).toHaveBeenCalledTimes(1)
  })

  it('labels the button as insert-row for a row marker', () => {
    hookMarker = {
      axis: 'row',
      side: 'before',
      anchorIndex: 0,
      left: 0,
      top: 40,
      lineLength: 300,
      cellPoint: { x: 50, y: 20 },
    }
    renderHandles()
    expect(screen.getByRole('button', { name: 'Insert row' })).toBeInTheDocument()
  })
})
