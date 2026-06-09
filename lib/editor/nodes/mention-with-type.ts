import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

type MentionAttrs = ProseMirrorNode['attrs']

const ENTITY_TYPES = new Set(['task', 'sprint', 'project', 'milestone'])

/** Pure: the DOM-spec array a mention node's renderHTML returns. */
export function renderMentionHTML(
  attrs: MentionAttrs,
  HTMLAttributes: Record<string, unknown>
): readonly [string, Record<string, any>, string] {
  const type = attrs.mentionType ?? 'user'

  if (!ENTITY_TYPES.has(type)) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'mention mention-user' }),
      `@${attrs.label ?? attrs.id}`,
    ]
  }

  const label = attrs.label ?? attrs.id
  const text =
    type === 'task' && attrs.mentionTitle
      ? `${label} ${attrs.mentionTitle}`
      : label
  return [
    'a',
    mergeAttributes(HTMLAttributes, {
      class: `mention mention-${type}`,
      ...(attrs.mentionHref ? { href: attrs.mentionHref } : {}),
      ...(attrs.mentionStatus
        ? { 'data-mention-status': attrs.mentionStatus }
        : {}),
    }),
    text,
  ]
}

/** Pure: the plain-text representation a mention node's renderText returns. */
export function renderMentionText(attrs: MentionAttrs): string {
  const type = attrs.mentionType ?? 'user'
  if (!ENTITY_TYPES.has(type)) return `@${attrs.label ?? attrs.id}`
  const label = attrs.label ?? attrs.id
  return type === 'task' && attrs.mentionTitle
    ? `${label} ${attrs.mentionTitle}`
    : label
}

/** Mention node extended with type / title / status / href attributes. */
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
          attrs.mentionTitle
            ? { 'data-mention-title': attrs.mentionTitle }
            : {},
      },
      mentionStatus: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-status') ?? null,
        renderHTML: attrs =>
          attrs.mentionStatus
            ? { 'data-mention-status': attrs.mentionStatus }
            : {},
      },
      mentionHref: {
        default: null,
        parseHTML: el => el.getAttribute('data-href') ?? null,
        renderHTML: attrs =>
          attrs.mentionHref ? { 'data-href': attrs.mentionHref } : {},
      },
    }
  },
  parseHTML() {
    // The custom renderHTML below emits `<a class="mention mention-*">` (entities)
    // and `<span class="mention mention-user">` (people) WITHOUT a
    // `data-type="mention"` attribute, so the default Mention parse rule
    // (span[data-type="mention"]) never matches. Claim our own serialized DOM
    // by class instead, so stored content round-trips in both the editor and
    // the read-only viewer.
    return [{ tag: 'a.mention' }, { tag: 'span.mention' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return renderMentionHTML(node.attrs, HTMLAttributes)
  },
  renderText({ node }) {
    return renderMentionText(node.attrs)
  },
})
