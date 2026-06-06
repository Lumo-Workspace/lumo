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
  LayoutList,
  Workflow,
} from 'lucide-react'

export interface SlashCommandItem {
  title: string
  description: string
  icon: React.ReactNode
  /** Stable grouping key — never localized, used for grouping and React keys. */
  categoryKey: 'basic' | 'media' | 'advanced'
  /** Localized display label for the category section header. */
  category: string
  command: (editor: Editor) => void
}

/** Localized-string lookup injected from the React layer (keeps this lib file
 *  free of react-intl). Defaults to returning English for the new items. */
export type SlashCommandTranslate = (id: string) => string

const FALLBACK_LABELS: Record<string, string> = {
  // Categories
  'editor.slash.category.basic': 'Basic',
  'editor.slash.category.media': 'Media',
  'editor.slash.category.advanced': 'Advanced',
  // Basic items
  'editor.slash.text.title': 'Text',
  'editor.slash.text.description': 'Plain text block',
  'editor.slash.heading1.title': 'Heading 1',
  'editor.slash.heading1.description': 'Large heading',
  'editor.slash.heading2.title': 'Heading 2',
  'editor.slash.heading2.description': 'Medium heading',
  'editor.slash.heading3.title': 'Heading 3',
  'editor.slash.heading3.description': 'Small heading',
  'editor.slash.bulletList.title': 'Bullet List',
  'editor.slash.bulletList.description': 'Unordered list',
  'editor.slash.numberedList.title': 'Numbered List',
  'editor.slash.numberedList.description': 'Ordered list',
  'editor.slash.taskList.title': 'Task List',
  'editor.slash.taskList.description': 'Checklist with checkboxes',
  // Media items
  'editor.slash.image.title': 'Image',
  'editor.slash.image.description': 'Insert an image',
  'editor.slash.image.prompt': 'Image URL',
  // Advanced items
  'editor.slash.table.title': 'Table',
  'editor.slash.table.description': 'Insert a table',
  'editor.slash.codeBlock.title': 'Code Block',
  'editor.slash.codeBlock.description': 'Code with syntax highlighting',
  'editor.slash.blockquote.title': 'Blockquote',
  'editor.slash.blockquote.description': 'Quoted text',
  'editor.slash.divider.title': 'Divider',
  'editor.slash.divider.description': 'Horizontal line',
  'editor.slash.callout.title': 'Callout',
  'editor.slash.callout.description': 'Highlighted note block',
  'editor.slash.toggle.title': 'Toggle',
  'editor.slash.toggle.description': 'Collapsible block',
  'editor.slash.taskView.title': 'Task View',
  'editor.slash.taskView.description': 'Live filtered task list',
  'editor.slash.mermaid.title': 'Mermaid Diagram',
  'editor.slash.mermaid.description': 'Diagram from text',
}

const ICON_SIZE = 16

export function getSlashCommandItems(
  t: SlashCommandTranslate = id => FALLBACK_LABELS[id] ?? id
): SlashCommandItem[] {
  return [
    // Basic
    {
      title: t('editor.slash.text.title'),
      description: t('editor.slash.text.description'),
      icon: <Type size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor => editor.chain().focus().setParagraph().run(),
    },
    {
      title: t('editor.slash.heading1.title'),
      description: t('editor.slash.heading1.description'),
      icon: <Heading1 size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: t('editor.slash.heading2.title'),
      description: t('editor.slash.heading2.description'),
      icon: <Heading2 size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: t('editor.slash.heading3.title'),
      description: t('editor.slash.heading3.description'),
      icon: <Heading3 size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: t('editor.slash.bulletList.title'),
      description: t('editor.slash.bulletList.description'),
      icon: <List size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: t('editor.slash.numberedList.title'),
      description: t('editor.slash.numberedList.description'),
      icon: <ListOrdered size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: t('editor.slash.taskList.title'),
      description: t('editor.slash.taskList.description'),
      icon: <ListTodo size={ICON_SIZE} />,
      categoryKey: 'basic',
      category: t('editor.slash.category.basic'),
      command: editor => editor.chain().focus().toggleTaskList().run(),
    },
    // Media
    {
      title: t('editor.slash.image.title'),
      description: t('editor.slash.image.description'),
      icon: <ImageIcon size={ICON_SIZE} />,
      categoryKey: 'media',
      category: t('editor.slash.category.media'),
      command: editor => {
        const url = window.prompt(t('editor.slash.image.prompt'))
        if (url) editor.chain().focus().setImage({ src: url }).run()
      },
    },
    // Advanced
    {
      title: t('editor.slash.table.title'),
      description: t('editor.slash.table.description'),
      icon: <Table2 size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: t('editor.slash.codeBlock.title'),
      description: t('editor.slash.codeBlock.description'),
      icon: <Code2 size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: t('editor.slash.blockquote.title'),
      description: t('editor.slash.blockquote.description'),
      icon: <Quote size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: t('editor.slash.divider.title'),
      description: t('editor.slash.divider.description'),
      icon: <Minus size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      title: t('editor.slash.callout.title'),
      description: t('editor.slash.callout.description'),
      icon: <Lightbulb size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setCallout().run(),
    },
    {
      title: t('editor.slash.toggle.title'),
      description: t('editor.slash.toggle.description'),
      icon: <ChevronRight size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setToggle().run(),
    },
    {
      title: t('editor.slash.taskView.title'),
      description: t('editor.slash.taskView.description'),
      icon: <LayoutList size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setTaskView().run(),
    },
    {
      title: t('editor.slash.mermaid.title'),
      description: t('editor.slash.mermaid.description'),
      icon: <Workflow size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setMermaid().run(),
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
