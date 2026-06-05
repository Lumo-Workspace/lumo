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
import { TaskLink } from './marks/task-link'
import { CommentMark } from './marks/comment-mark'
import { CodeBlock } from './nodes/code-block'
import { Callout } from './nodes/callout'
import { ToggleExtensions } from './nodes/toggle'
import { TaskView } from './nodes/task-view'

export function getBaseExtensions(): Extensions {
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
      HTMLAttributes: { class: 'text-blue-500 underline cursor-pointer' },
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
    ...ToggleExtensions,
    TaskView,
    TaskLink,
    CommentMark,
    // Storage-only: powers the word/character/reading-time footer. The
    // CJK-aware word + reading-time math lives in lib/editor/reading-stats.ts;
    // we read characters() from this extension's storage.
    CharacterCount,
  ]
}
