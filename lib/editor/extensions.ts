import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import { TaskItemWithLink as TaskItem } from './nodes/task-item-with-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { CharacterCount } from '@tiptap/extension-character-count'
import type { Extensions } from '@tiptap/core'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'
import { MentionWithType } from './nodes/mention-with-type'
import { TaskLink } from './marks/task-link'
import { CommentMark } from './marks/comment-mark'
import { CodeBlock } from './nodes/code-block'
import { Callout } from './nodes/callout'
import { Mermaid } from './nodes/mermaid'
import { ToggleExtensions } from './nodes/toggle'
import { TaskView } from './nodes/task-view'
import { EDITOR_LINK_CLASS } from './link-class'

export function getBaseExtensions(opts?: {
  mentionSuggestion?: Partial<SuggestionOptions>
  /**
   * Optional React node view for mention nodes (LUM-411). Injected by the
   * read-only viewer to render live status/PR badges on `@LUM-N` chips; the
   * editor omits it and keeps the pure renderHTML path, so editing is
   * unchanged. Lives app-side so `lib/editor` doesn't import UI components.
   */
  mentionNodeView?: ComponentType<ReactNodeViewProps>
}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // Replaced by the lowlight-backed CodeBlock below (syntax highlighting
      // + language dropdown). Both the editor and read-only viewer use it.
      codeBlock: false,
    }),
    CodeBlock,
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { class: EDITOR_LINK_CLASS },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Typography,
    Callout,
    Mermaid,
    ...ToggleExtensions,
    TaskView,
    TaskLink,
    CommentMark,
    // Storage-only: powers the word/character/reading-time footer. The
    // CJK-aware word + reading-time math lives in lib/editor/reading-stats.ts;
    // we read characters() from this extension's storage.
    CharacterCount,
    // Single mention node for the whole base. Editors pass a suggestion to
    // enable the '@' dropdown; the read-only viewer passes a node view to
    // render live status/PR badges. Always exactly one 'mention' node.
    buildMentionNode(opts),
  ]
}

function buildMentionNode(opts?: {
  mentionSuggestion?: Partial<SuggestionOptions>
  mentionNodeView?: ComponentType<ReactNodeViewProps>
}) {
  const node = opts?.mentionSuggestion
    ? MentionWithType.configure({ suggestion: opts.mentionSuggestion })
    : MentionWithType
  if (!opts?.mentionNodeView) return node
  const Component = opts.mentionNodeView
  // Returning a node view falls the editor's renderHTML back to it; without
  // one (editor path) Tiptap keeps using renderHTML (core: !nodeViewResult).
  return node.extend({
    addNodeView() {
      return ReactNodeViewRenderer(Component)
    },
  })
}
