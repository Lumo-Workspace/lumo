/** @jest-environment jsdom */

// LUM-1275: the bubble-menu submenus run on Radix DropdownMenu / Popover and
// must never cost the editor its selection. Pointer-opened menus leave focus
// in the editor; keyboard-opened menus move focus in so arrows walk items;
// Esc closes without running a command and hands focus back to the editor
// (whose ProseMirror selection is untouched).

const messages: Record<string, string> = {
  'editor.align': 'Alignment',
  'editor.alignLeft': 'Align left',
  'editor.alignCenter': 'Align center',
  'editor.alignRight': 'Align right',
  'table.actions': 'Table',
  'table.addRowAbove': 'Add row above',
  'table.addRowBelow': 'Add row below',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AlignMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu'
import { ColorPicker } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/ColorPicker'
import { TableActionsMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu'

if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}
const tick = () => act(() => new Promise(r => setTimeout(r, 0)))

function makeEditor(hasFocus: () => boolean) {
  const chainCalls: string[] = []
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === 'run'
          ? () => true
          : () => {
              chainCalls.push(prop)
              return chain
            },
    }
  )
  const focus = jest.fn()
  const editor = {
    chain: () => chain,
    commands: { focus },
    view: { hasFocus },
  } as unknown as Editor
  return { editor, chainCalls, focus }
}

const focusedText = () => document.activeElement?.textContent?.trim()

describe('bubble-menu submenus keep the editor selection (LUM-1275)', () => {
  it('keyboard-opened menu focuses the first item and arrow keys move through items', async () => {
    const { editor, chainCalls } = makeEditor(() => false)
    render(
      <AlignMenu
        editor={editor}
        alignLeft
        alignCenter={false}
        alignRight={false}
      />
    )
    const trigger = screen.getByRole('button', { name: 'Alignment' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await tick()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(focusedText()).toBe('Align left')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await tick()
    expect(focusedText()).toBe('Align center')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await tick()
    expect(focusedText()).toBe('Align right')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    await tick()
    expect(focusedText()).toBe('Align center')
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(chainCalls).toEqual(['focus', 'setTextAlign'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Esc closes a keyboard-opened menu without running a command and refocuses the editor', async () => {
    const { editor, chainCalls, focus } = makeEditor(() => false)
    render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
    const trigger = screen.getByRole('button', { name: 'Table' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await tick()
    expect(focusedText()).toBe('Add row above')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await tick()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(chainCalls).toEqual([])
    // focus() with no position restores the editor's existing selection.
    expect(focus).toHaveBeenCalledWith()
  })

  it('pointer-opened menu leaves focus in the editor through open, hover and Esc', async () => {
    render(
      <div data-testid='pm' contentEditable suppressContentEditableWarning />
    )
    const pm = screen.getByTestId('pm')
    pm.focus()
    const { editor, chainCalls, focus } = makeEditor(
      () => document.activeElement === pm
    )
    render(
      <AlignMenu
        editor={editor}
        alignLeft
        alignCenter={false}
        alignRight={false}
      />
    )
    const trigger = screen.getByRole('button', { name: 'Alignment' })
    const md = fireEvent.mouseDown(trigger)
    expect(md).toBe(false) // mousedown cancelled → no blur
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    await tick()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(document.activeElement).toBe(pm)

    const item = screen.getByText('Align center')
    fireEvent.pointerMove(item, { pointerType: 'mouse' })
    expect(document.activeElement).toBe(pm)
    expect(fireEvent.mouseDown(item)).toBe(false)

    fireEvent.keyDown(pm, { key: 'Escape' })
    await tick()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(pm)
    expect(chainCalls).toEqual([])
    expect(focus).not.toHaveBeenCalled()
  })

  it('color popover keeps editor focus when opened by pointer and applies on click', async () => {
    render(
      <div data-testid='pm' contentEditable suppressContentEditableWarning />
    )
    const pm = screen.getByTestId('pm')
    pm.focus()
    const { editor, chainCalls } = makeEditor(
      () => document.activeElement === pm
    )
    render(<ColorPicker editor={editor} currentColor='' currentHighlight='' />)
    const trigger = screen.getByRole('button', { name: 'Text color' })
    expect(fireEvent.mouseDown(trigger)).toBe(false)
    fireEvent.click(trigger)
    await tick()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.activeElement).toBe(pm)
    // Font-colour 'Red' comes first; the background row has its own 'Red'.
    const red = screen.getAllByRole('button', { name: 'Red' })[0]!
    expect(fireEvent.mouseDown(red)).toBe(false)
    fireEvent.click(red)
    expect(chainCalls).toEqual(['focus', 'setColor'])
    await tick()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('color popover opened from the keyboard focuses the first swatch', async () => {
    const { editor } = makeEditor(() => false)
    render(<ColorPicker editor={editor} currentColor='' currentHighlight='' />)
    const trigger = screen.getByRole('button', { name: 'Text color' })
    trigger.focus()
    fireEvent.click(trigger)
    await tick()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Default' })
    )
  })
})
