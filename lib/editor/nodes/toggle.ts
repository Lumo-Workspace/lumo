// lib/editor/nodes/toggle.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ToggleNodeView } from './toggle-node-view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Insert a collapsible toggle (open by default) with an empty body. */
      setToggle: () => ReturnType
    }
  }
}

/** Pure: parse the persisted `data-open` attribute. Only "false" collapses. */
export function parseToggleOpen(value: string | null): boolean {
  return value !== 'false'
}

/** Pure: serialize the `open` attribute. */
export function renderToggleOpenAttr(open: boolean): { 'data-open': string } {
  return { 'data-open': open ? 'true' : 'false' }
}

/** Title row of a toggle — inline rich text (bold, mentions, inline code). */
export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-toggle-summary]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-toggle-summary': '' }),
      0,
    ]
  },
})

/** Collapsible body of a toggle — arbitrary block content. */
export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-toggle-content]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-toggle-content': '' }),
      0,
    ]
  },
})

/** Toggle wrapper: a summary followed by a collapsible content block. */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: el => parseToggleOpen(el.getAttribute('data-open')),
        renderHTML: attrs => renderToggleOpenAttr(Boolean(attrs.open)),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView)
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              { type: 'toggleSummary' },
              { type: 'toggleContent', content: [{ type: 'paragraph' }] },
            ],
          }),
    }
  },
})

/** All three nodes, ready to spread into getBaseExtensions(). */
export const ToggleExtensions = [Toggle, ToggleSummary, ToggleContent]
