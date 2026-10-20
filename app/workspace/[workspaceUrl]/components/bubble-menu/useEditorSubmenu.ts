'use client'

import { useState } from 'react'
import type { Editor } from '@tiptap/core'

/**
 * Focus wiring for a Radix DropdownMenu / Popover hung off the editor's bubble
 * menu, so opening it never costs the editor its selection.
 *
 * - Opened with the pointer while the editor has focus, focus stays in the
 *   editor: the trigger and items cancel `mousedown`, open auto-focus is
 *   cancelled, and Radix's hover-to-focus on items is skipped. The editor never
 *   blurs, so TipTap's BubbleMenu (which hides on editor blur) stays put and
 *   the command applies to the live selection. Esc still closes the submenu
 *   (Radix listens on the document).
 * - Opened from the keyboard (focus already on the trigger), Radix moves focus
 *   into the content as usual so arrow keys walk the items; ProseMirror keeps
 *   its selection while blurred and each command re-focuses the editor.
 * - On close, focus is handed back to the editor (selection intact) unless the
 *   user has already moved it somewhere else.
 */
export function useEditorSubmenu(editor: Editor) {
  const [open, setOpen] = useState(false)

  const editorHasFocus = () => editor.view?.hasFocus() ?? false

  const keepEditorFocus = (e: { preventDefault: () => void }) => {
    if (editorHasFocus()) e.preventDefault()
  }

  const triggerProps = {
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
  }

  const contentProps = {
    onOpenAutoFocus: keepEditorFocus,
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault()
      const active = document.activeElement
      const content = e.currentTarget as Node | null
      if (
        !active ||
        active === document.body ||
        (content?.contains?.(active) ?? false)
      ) {
        editor.commands.focus()
      }
    },
  }

  const itemProps = {
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onPointerMove: keepEditorFocus,
    onPointerLeave: keepEditorFocus,
  }

  return { open, setOpen, triggerProps, contentProps, itemProps }
}
