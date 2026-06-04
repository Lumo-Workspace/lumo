import type { Editor } from '@tiptap/core'
import { runTableInsert, type InsertMarker } from '@/lib/editor/table/insert-command'

// chainable stub: every method returns the chain; run() is terminal.
function makeEditor(posResult: { pos: number } | null) {
  const chain: Record<string, jest.Mock> = {}
  for (const m of [
    'focus',
    'setTextSelection',
    'addColumnBefore',
    'addColumnAfter',
    'addRowBefore',
    'addRowAfter',
    'run',
  ]) {
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  }
  const editor = {
    chain: () => chain,
    view: { posAtCoords: jest.fn(() => posResult) },
  } as unknown as Editor
  return { editor, chain }
}

const marker = (over: Partial<InsertMarker>): InsertMarker => ({
  axis: 'col',
  side: 'after',
  anchorIndex: 0,
  left: 0,
  top: 0,
  lineLength: 80,
  cellPoint: { x: 50, y: 20 },
  ...over,
})

describe('runTableInsert', () => {
  it('places the selection at the resolved pos then inserts a column after', () => {
    const { editor, chain } = makeEditor({ pos: 7 })
    runTableInsert(editor, marker({ axis: 'col', side: 'after' }))
    expect(editor.view.posAtCoords).toHaveBeenCalledWith({ left: 50, top: 20 })
    expect(chain.setTextSelection).toHaveBeenCalledWith(7)
    expect(chain.addColumnAfter).toHaveBeenCalled()
    expect(chain.run).toHaveBeenCalled()
  })

  it('inserts a row before for a row/before marker', () => {
    const { editor, chain } = makeEditor({ pos: 3 })
    runTableInsert(editor, marker({ axis: 'row', side: 'before' }))
    expect(chain.addRowBefore).toHaveBeenCalled()
    expect(chain.addColumnAfter).not.toHaveBeenCalled()
  })

  it('does nothing when posAtCoords returns null', () => {
    const { editor, chain } = makeEditor(null)
    runTableInsert(editor, marker({}))
    expect(chain.setTextSelection).not.toHaveBeenCalled()
    expect(chain.addColumnAfter).not.toHaveBeenCalled()
  })
})
