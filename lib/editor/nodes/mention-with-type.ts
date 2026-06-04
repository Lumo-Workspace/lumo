import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

type MentionAttrs = ProseMirrorNode['attrs']

/** Pure: the DOM-spec array a mention node's renderHTML returns. */
export function renderMentionHTML(
  attrs: MentionAttrs,
  HTMLAttributes: Record<string, unknown>
): readonly [string, Record<string, any>, string] {
  const isTask = attrs.mentionType === 'task'
  if (isTask) {
    const label = attrs.label ?? attrs.id
    const title = attrs.mentionTitle ?? ''
    const text = title ? `${label} ${title}` : label
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'mention mention-task',
        'data-mention-type': 'task',
        ...(attrs.mentionStatus
          ? { 'data-mention-status': attrs.mentionStatus }
          : {}),
      }),
      text,
    ]
  }
  return [
    'span',
    mergeAttributes(HTMLAttributes, { class: 'mention' }),
    `@${attrs.label ?? attrs.id}`,
  ]
}

/** Pure: the plain-text representation a mention node's renderText returns. */
export function renderMentionText(attrs: MentionAttrs): string {
  const isTask = attrs.mentionType === 'task'
  if (isTask) {
    const label = attrs.label ?? attrs.id
    return attrs.mentionTitle ? `${label} ${attrs.mentionTitle}` : label
  }
  return `@${attrs.label ?? attrs.id}`
}

/** Mention node extended with type / title / status attributes. */
export const MentionWithType = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionType: {
        default: 'user',
        parseHTML: el => el.getAttribute('data-mention-type') ?? 'user',
        renderHTML: attrs => ({ 'data-mention-type': attrs.mentionType }),
      },
      mentionTitle: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-title') ?? null,
        renderHTML: attrs =>
          attrs.mentionTitle ? { 'data-mention-title': attrs.mentionTitle } : {},
      },
      mentionStatus: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-status') ?? null,
        renderHTML: attrs =>
          attrs.mentionStatus
            ? { 'data-mention-status': attrs.mentionStatus }
            : {},
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return renderMentionHTML(node.attrs, HTMLAttributes)
  },
  renderText({ node }) {
    return renderMentionText(node.attrs)
  },
})
