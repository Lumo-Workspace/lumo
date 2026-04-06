import { Extension } from '@tiptap/core'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'
import type React from 'react'

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  category: string
  command: (editor: Editor) => void
}

export function getSlashCommandItems(): SlashCommandItem[] {
  return [
    // Basic
    {
      title: 'Text',
      description: 'Plain text block',
      icon: '\u{1F4DD}',
      category: 'Basic',
      command: editor => editor.chain().focus().setParagraph().run(),
    },
    {
      title: 'Heading 1',
      description: 'Large heading',
      icon: 'H1',
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: 'Heading 2',
      description: 'Medium heading',
      icon: 'H2',
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: 'Heading 3',
      description: 'Small heading',
      icon: 'H3',
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: 'Bullet List',
      description: 'Unordered list',
      icon: '\u2022',
      category: 'Basic',
      command: editor => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: 'Numbered List',
      description: 'Ordered list',
      icon: '1.',
      category: 'Basic',
      command: editor => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: 'Task List',
      description: 'Checklist with checkboxes',
      icon: '\u2611\uFE0F',
      category: 'Basic',
      command: editor => editor.chain().focus().toggleTaskList().run(),
    },
    // Media
    {
      title: 'Image',
      description: 'Insert an image',
      icon: '\u{1F5BC}\uFE0F',
      category: 'Media',
      command: editor => {
        const url = window.prompt('Image URL')
        if (url) editor.chain().focus().setImage({ src: url }).run()
      },
    },
    // Advanced
    {
      title: 'Table',
      description: 'Insert a table',
      icon: '\u{1F4CA}',
      category: 'Advanced',
      command: editor =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: 'Code Block',
      description: 'Code with syntax highlighting',
      icon: '\u{1F4BB}',
      category: 'Advanced',
      command: editor => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: 'Blockquote',
      description: 'Quoted text',
      icon: '\u{1F4AC}',
      category: 'Advanced',
      command: editor => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: 'Divider',
      description: 'Horizontal line',
      icon: '\u2014',
      category: 'Advanced',
      command: editor => editor.chain().focus().setHorizontalRule().run(),
    },
  ]
}

export type SlashCommandPopupState = {
  items: SlashCommandItem[]
  rect: DOMRect
  command: (item: SlashCommandItem) => void
}

export function buildSlashCommandSuggestion(
  onOpen: (state: SlashCommandPopupState) => void,
  onUpdate: (state: SlashCommandPopupState) => void,
  onClose: () => void,
  listRef: React.RefObject<{
    onKeyDown: (props: { event: KeyboardEvent }) => boolean
  } | null>
): Partial<SuggestionOptions> {
  const allItems = getSlashCommandItems()

  return {
    char: '/',
    items: ({ query }) => {
      if (!query) return allItems
      const q = query.toLowerCase()
      return allItems.filter(
        item =>
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
      )
    },
    render() {
      return {
        onStart(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          onOpen({
            items: props.items as SlashCommandItem[],
            rect,
            command: (item: SlashCommandItem) => {
              props.command(item)
            },
          })
        },
        onUpdate(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          onUpdate({
            items: props.items as SlashCommandItem[],
            rect,
            command: (item: SlashCommandItem) => {
              props.command(item)
            },
          })
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            onClose()
            return true
          }
          return listRef.current?.onKeyDown(props) ?? false
        },
        onExit() {
          onClose()
        },
      }
    },
    command: ({ editor, range, props }) => {
      const item = props as unknown as SlashCommandItem
      editor.chain().focus().deleteRange(range).run()
      item.command(editor)
    },
  }
}

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {} as Partial<SuggestionOptions>,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
