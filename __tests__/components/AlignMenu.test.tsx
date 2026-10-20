/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'editor.align': 'Alignment',
  'editor.alignLeft': 'Align left',
  'editor.alignCenter': 'Align center',
  'editor.alignRight': 'Align right',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AlignMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu'

// jsdom has no PointerEvent, so fireEvent.pointerDown would drop `button`
// and the Radix DropdownMenu trigger (which opens on pointerdown) ignores it.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}
const openMenu = (el: HTMLElement) =>
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false })

function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  for (const m of ['focus', 'setTextAlign', 'run']) {
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  }
  const editor = {
    chain: () => chain,
    commands: { focus: jest.fn() },
  } as unknown as Editor
  return { editor, chain }
}

describe('AlignMenu', () => {
  it('is collapsed until clicked, then lists the three alignments', () => {
    const { editor } = makeEditor()
    render(
      <AlignMenu
        editor={editor}
        alignLeft
        alignCenter={false}
        alignRight={false}
      />
    )
    expect(screen.queryByText('Align center')).not.toBeInTheDocument()
    openMenu(screen.getByRole('button', { name: /alignment/i }))
    expect(screen.getByText('Align left')).toBeInTheDocument()
    expect(screen.getByText('Align center')).toBeInTheDocument()
    expect(screen.getByText('Align right')).toBeInTheDocument()
  })

  it('applies the chosen alignment and closes', () => {
    const { editor, chain } = makeEditor()
    render(
      <AlignMenu
        editor={editor}
        alignLeft
        alignCenter={false}
        alignRight={false}
      />
    )
    openMenu(screen.getByRole('button', { name: /alignment/i }))
    fireEvent.click(screen.getByText('Align center'))
    expect(chain.setTextAlign).toHaveBeenCalledWith('center')
    expect(screen.queryByText('Align center')).not.toBeInTheDocument()
  })
})
