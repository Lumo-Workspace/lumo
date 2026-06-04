// lib/editor/nodes/callout.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import {
  getCalloutVariant,
  DEFAULT_CALLOUT_VARIANT,
  type CalloutVariantKey,
} from './callout-variants'
import { CalloutNodeView } from './callout-node-view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Insert an empty callout of the given variant (default: info). */
      setCallout: (attrs?: { variant?: CalloutVariantKey }) => ReturnType
    }
  }
}

/**
 * Pure helper (testable without an Editor): the DOM attributes a callout
 * with the given variant serializes to. Emoji is NEVER serialized — it is
 * derived from `variant` in {@link CalloutNodeView}, the single source of truth.
 */
export function calloutAttributesForVariant(value: unknown): {
  'data-variant': CalloutVariantKey
} {
  return { 'data-variant': getCalloutVariant(value).key }
}

/**
 * Callout block: emoji + colored highlight. Holds arbitrary block content.
 * Same NodeView runs in the editor and the read-only viewer (registered via
 * getBaseExtensions); the variant dropdown is gated on editor.isEditable.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: DEFAULT_CALLOUT_VARIANT,
        parseHTML: el => getCalloutVariant(el.getAttribute('data-variant')).key,
        renderHTML: attrs => calloutAttributesForVariant(attrs.variant),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView)
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { variant: attrs.variant ?? DEFAULT_CALLOUT_VARIANT },
            content: [{ type: 'paragraph' }],
          }),
    }
  },
})
