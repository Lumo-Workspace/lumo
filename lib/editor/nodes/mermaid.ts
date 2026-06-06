// lib/editor/nodes/mermaid.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MermaidView } from './mermaid-view'

/** Seed source inserted by the slash command so a fresh block renders. */
export const DEFAULT_MERMAID_SOURCE = 'graph TD\n  A[Start] --> B[End]'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert a Mermaid block (defaults to the starter template). */
      setMermaid: (attrs?: { source?: string }) => ReturnType
    }
  }
}

/**
 * Mermaid diagram block. Atom node (no editable inner content) whose `source`
 * is serialized as VISIBLE text inside `<pre data-type="mermaid"><code>…</code></pre>`.
 * Storing the source as text means the HTML-text-diff RevisionDiffView shows
 * source diffs for free. The same node view runs in the editor and the
 * read-only RichTextViewer (both call getBaseExtensions).
 */
export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        // Read the diagram source from the element's text content.
        parseHTML: el => el.textContent ?? '',
        // Source is emitted as text content in renderHTML, not as an attribute.
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    // priority > 50 (default) so this rule wins over CodeBlock's generic
    // `pre` rule when Tiptap assembles the schema's parseDOM array.
    return [{ tag: 'pre[data-type="mermaid"]', priority: 100 }]
  },

  renderHTML({ node }) {
    return [
      'pre',
      mergeAttributes({ 'data-type': 'mermaid' }),
      ['code', {}, (node.attrs.source as string) ?? ''],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      setMermaid:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { source: attrs.source ?? DEFAULT_MERMAID_SOURCE },
          }),
    }
  },
})
