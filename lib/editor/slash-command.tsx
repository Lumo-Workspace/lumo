import { Extension } from '@tiptap/core'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'
import type React from 'react'
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  ImageIcon,
  Table2,
  Code2,
  Quote,
  Minus,
  Lightbulb,
  ChevronRight,
} from 'lucide-react'

export interface SlashCommandItem {
  title: string
  description: string
  icon: React.ReactNode
  category: string
  command: (editor: Editor) => void
}

/** Localized-string lookup injected from the React layer (keeps this lib file
 *  free of react-intl). Defaults to returning English for the new items. */
export type SlashCommandTranslate = (id: string) => string

const FALLBACK_LABELS: Record<string, string> = {
  'editor.slash.callout.title': 'Callout',
  'editor.slash.callout.description': 'Highlighted note block',
  'editor.slash.toggle.title': 'Toggle',
  'editor.slash.toggle.description': 'Collapsible block',
}

const ICON_SIZE = 16

export function getSlashCommandItems(
  t: SlashCommandTranslate = id => FALLBACK_LABELS[id] ?? id
): SlashCommandItem[] {
  return [
    // Basic
    {
      title: 'Text',
      description: 'Plain text block',
      icon: <Type size={ICON_SIZE} />,
      category: 'Basic',
      command: editor => editor.chain().focus().setParagraph().run(),
    },
    {
      title: 'Heading 1',
      description: 'Large heading',
      icon: <Heading1 size={ICON_SIZE} />,
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: 'Heading 2',
      description: 'Medium heading',
      icon: <Heading2 size={ICON_SIZE} />,
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: 'Heading 3',
      description: 'Small heading',
      icon: <Heading3 size={ICON_SIZE} />,
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: 'Bullet List',
      description: 'Unordered list',
      icon: <List size={ICON_SIZE} />,
      category: 'Basic',
      command: editor => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: 'Numbered List',
      description: 'Ordered list',
      icon: <ListOrdered size={ICON_SIZE} />,
      category: 'Basic',
      command: editor => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: 'Task List',
      description: 'Checklist with checkboxes',
      icon: <ListTodo size={ICON_SIZE} />,
      category: 'Basic',
      command: editor => editor.chain().focus().toggleTaskList().run(),
    },
    // Media
    {
      title: 'Image',
      description: 'Insert an image',
      icon: <ImageIcon size={ICON_SIZE} />,
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
      icon: <Table2 size={ICON_SIZE} />,
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
      icon: <Code2 size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: 'Blockquote',
      description: 'Quoted text',
      icon: <Quote size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: 'Divider',
      description: 'Horizontal line',
      icon: <Minus size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      title: t('editor.slash.callout.title'),
      description: t('editor.slash.callout.description'),
      icon: <Lightbulb size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().setCallout().run(),
    },
    {
      title: t('editor.slash.toggle.title'),
      description: t('editor.slash.toggle.description'),
      icon: <ChevronRight size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().setToggle().run(),
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
  } | null>,
  t?: SlashCommandTranslate | undefined
): Partial<SuggestionOptions> {
  const allItems = getSlashCommandItems(t)

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
