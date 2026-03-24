'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { WorkspaceMemberInfo, ApiTask } from '../types'
import { buildMentionSuggestion } from './mention-suggestion'

/** Mention node extended with type / title / status attributes */
const MentionWithType = Mention.extend({
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
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const isTask = node.attrs.mentionType === 'task'
    if (isTask) {
      const label = node.attrs.label ?? node.attrs.id
      const title = node.attrs.mentionTitle ?? ''
      const text = title ? `${label} ${title}` : label
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          class: 'mention mention-task',
          'data-mention-type': 'task',
          ...(node.attrs.mentionStatus
            ? { 'data-mention-status': node.attrs.mentionStatus }
            : {}),
        }),
        text,
      ]
    }
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'mention' }),
      `@${node.attrs.label ?? node.attrs.id}`,
    ]
  },
  renderText({ node }) {
    const isTask = node.attrs.mentionType === 'task'
    if (isTask) {
      const label = node.attrs.label ?? node.attrs.id
      return node.attrs.mentionTitle
        ? `${label} ${node.attrs.mentionTitle}`
        : label
    }
    return `@${node.attrs.label ?? node.attrs.id}`
  },
})
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Code2,
  Quote,
  List,
  ListOrdered,
  ListTodo,
  ChevronDown,
  Link2,
  Link2Off,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ─── Bubble menu toolbar ───────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          onMouseDown={e => {
            e.preventDefault() // prevent editor blur
            onClick()
          }}
          className={cn(
            'flex items-center justify-center size-7 rounded transition-colors',
            active
              ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

function Divider() {
  return (
    <div className='w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5 shrink-0' />
  )
}

const TEXT_STYLES = [
  {
    label: 'Regular text',
    action: (e: Editor) => e.chain().focus().setParagraph().run(),
    isActive: (e: Editor) => e.isActive('paragraph'),
  },
  {
    label: 'Heading 1',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 1 }),
  },
  {
    label: 'Heading 2',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 2 }),
  },
  {
    label: 'Heading 3',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 3 }),
  },
  {
    label: 'Heading 4',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 4 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 4 }),
  },
]

const LIST_STYLES = [
  {
    label: 'List',
    icon: <List size={14} />,
    action: (e: Editor) => e.chain().focus().toggleBulletList().run(),
    isActive: (e: Editor) => e.isActive('bulletList'),
  },
  {
    label: 'Numbered list',
    icon: <ListOrdered size={14} />,
    action: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e: Editor) => e.isActive('orderedList'),
  },
  {
    label: 'Checklist',
    icon: <ListTodo size={14} />,
    action: (e: Editor) => e.chain().focus().toggleTaskList().run(),
    isActive: (e: Editor) => e.isActive('taskList'),
  },
]

function BubbleMenuBar({
  editor,
  openLinkInputRef,
}: {
  editor: Editor
  openLinkInputRef: React.MutableRefObject<(() => void) | null>
}) {
  const [styleOpen, setStyleOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/i.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl+'
  const styleRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    if (!styleOpen && !listOpen) return
    const handler = (e: MouseEvent) => {
      if (!styleRef.current?.contains(e.target as Node)) setStyleOpen(false)
      if (!listRef.current?.contains(e.target as Node)) setListOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [styleOpen, listOpen])

  // Subscribe to editor state so buttons re-render on every transaction
  const state = useEditorState({
    editor,
    selector: ctx => ({
      isBold: ctx.editor.isActive('bold'),
      isItalic: ctx.editor.isActive('italic'),
      isUnderline: ctx.editor.isActive('underline'),
      isStrike: ctx.editor.isActive('strike'),
      isCode: ctx.editor.isActive('code'),
      isCodeBlock: ctx.editor.isActive('codeBlock'),
      isBlockquote: ctx.editor.isActive('blockquote'),
      isLink: ctx.editor.isActive('link'),
      isBulletList: ctx.editor.isActive('bulletList'),
      isOrderedList: ctx.editor.isActive('orderedList'),
      isTaskList: ctx.editor.isActive('taskList'),
      isParagraph: ctx.editor.isActive('paragraph'),
      isH1: ctx.editor.isActive('heading', { level: 1 }),
      isH2: ctx.editor.isActive('heading', { level: 2 }),
      isH3: ctx.editor.isActive('heading', { level: 3 }),
      isH4: ctx.editor.isActive('heading', { level: 4 }),
    }),
  })

  function openLinkInput() {
    const existing = editor.getAttributes('link').href as string | undefined
    setLinkUrl(existing ?? '')
    setLinkOpen(true)
    setTimeout(() => linkInputRef.current?.focus(), 0)
  }

  // Keep the ref in sync so the editor's handleKeyDown can call this
  useEffect(() => {
    openLinkInputRef.current = openLinkInput
  })

  function applyLink() {
    const href = linkUrl.trim()
    if (!href) {
      editor.chain().focus().unsetLink().run()
    } else {
      editor
        .chain()
        .focus()
        .setLink({
          href: /^https?:\/\//i.test(href) ? href : `https://${href}`,
        })
        .run()
    }
    setLinkOpen(false)
    setLinkUrl('')
  }

  const activeFlags = [
    state.isParagraph,
    state.isH1,
    state.isH2,
    state.isH3,
    state.isH4,
  ]
  const activeStyle =
    TEXT_STYLES.find((_, i) => activeFlags[i]) ?? TEXT_STYLES[0]!

  // Link URL input panel
  if (linkOpen) {
    return (
      <div className='flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg'>
        <Link2 size={13} className='shrink-0 text-zinc-400' />
        <input
          ref={linkInputRef}
          type='url'
          value={linkUrl}
          onChange={e => setLinkUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyLink()
            }
            if (e.key === 'Escape') {
              setLinkOpen(false)
              setLinkUrl('')
            }
          }}
          placeholder='https://'
          className='w-52 text-xs bg-transparent outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400'
        />
        <button
          type='button'
          onMouseDown={e => {
            e.preventDefault()
            applyLink()
          }}
          className='text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors px-1'
        >
          Apply
        </button>
        {state.isLink && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  editor.chain().focus().unsetLink().run()
                  setLinkOpen(false)
                }}
                className='text-zinc-400 hover:text-destructive transition-colors'
              >
                <Link2Off size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Remove link</TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <div className='flex items-center gap-0.5 px-1.5 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg'>
      {/* Text style dropdown — custom, no portal to avoid first-render position bug */}
      <div ref={styleRef} className='relative'>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onMouseDown={e => {
                e.preventDefault()
                setStyleOpen(o => !o)
              }}
              className='flex items-center gap-1 px-1.5 h-7 rounded text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
            >
              {activeStyle.label}
              <ChevronDown size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{activeStyle.label}</TooltipContent>
        </Tooltip>
        {styleOpen && (
          <div className='absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg py-1'>
            {TEXT_STYLES.map((style, i) => (
              <button
                key={style.label}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  style.action(editor)
                  setStyleOpen(false)
                }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
                  activeFlags[i]
                    ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-400'
                )}
              >
                {style.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* Inline formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={state.isBold}
        title={`Bold ${mod}B`}
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={state.isItalic}
        title={`Italic ${mod}I`}
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={state.isUnderline}
        title={`Underline ${mod}U`}
      >
        <UnderlineIcon size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={openLinkInput}
        active={state.isLink}
        title={`Link ${mod}K`}
      >
        <Link2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={state.isStrike}
        title='Strikethrough'
      >
        <Strikethrough size={14} />
      </ToolbarButton>

      <Divider />

      {/* Inline code */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={state.isCode}
        title='Inline code'
      >
        <Code size={14} />
      </ToolbarButton>

      {/* Code block */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={state.isCodeBlock}
        title='Code block'
      >
        <Code2 size={14} />
      </ToolbarButton>

      {/* Blockquote */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={state.isBlockquote}
        title={`Quote ${isMac ? '⌘⇧B' : 'Ctrl+Shift+B'}`}
      >
        <Quote size={14} />
      </ToolbarButton>

      <Divider />

      {/* List dropdown */}
      <div ref={listRef} className='relative'>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onMouseDown={e => {
                e.preventDefault()
                setListOpen(o => !o)
              }}
              className={cn(
                'flex items-center gap-1 px-1.5 h-7 rounded transition-colors',
                state.isBulletList || state.isOrderedList || state.isTaskList
                  ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100'
              )}
            >
              <List size={14} />
              <ChevronDown size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {state.isOrderedList
              ? 'Numbered list'
              : state.isTaskList
                ? 'Checklist'
                : 'List'}
          </TooltipContent>
        </Tooltip>
        {listOpen && (
          <div className='absolute top-full left-0 mt-1 z-50 min-w-[150px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg py-1'>
            {LIST_STYLES.map(style => {
              const active = style.isActive(editor)
              return (
                <button
                  key={style.label}
                  type='button'
                  onMouseDown={e => {
                    e.preventDefault()
                    style.action(editor)
                    setListOpen(false)
                  }}
                  className={cn(
                    'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
                    active
                      ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400'
                  )}
                >
                  {style.icon}
                  {style.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main editor ───────────────────────────────────────────────────────────────

interface DescriptionEditorProps {
  value: string | null
  onCommit: (html: string | null) => void
  onChange?: (html: string | null) => void
  placeholder?: string
  members?: WorkspaceMemberInfo[]
  tasks?: ApiTask[]
}

export function DescriptionEditor({
  value,
  onCommit,
  onChange,
  placeholder = 'Add a description…',
  members = [],
  tasks = [],
}: DescriptionEditorProps) {
  const isFocusedRef = useRef(false)
  const openLinkInputRef = useRef<(() => void) | null>(null)

  // Stable DOM element for the bubble menu (created once, never changes)
  const [menuElement] = useState<HTMLDivElement | null>(() =>
    typeof document !== 'undefined' ? document.createElement('div') : null
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      MentionWithType.configure({
        suggestion: buildMentionSuggestion(members, tasks),
      }),
      ...(menuElement
        ? [
            BubbleMenu.configure({
              element: menuElement,
              // Only show for non-empty text selections
              shouldShow: ({ editor, state }) => {
                const { selection } = state
                const { empty } = selection
                if (empty) return false
                return editor.isEditable
              },
            }),
          ]
        : []),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[80px]',
      },
      handleKeyDown: (_, event) => {
        const isMac =
          typeof navigator !== 'undefined' &&
          /Mac|iPhone|iPad/i.test(navigator.platform)
        if ((isMac ? event.metaKey : event.ctrlKey) && event.key === 'k') {
          event.preventDefault()
          openLinkInputRef.current?.()
          return true
        }
        return false
      },
    },
    onFocus: () => {
      isFocusedRef.current = true
    },
    onBlur: ({ editor }) => {
      isFocusedRef.current = false
      const html = editor.isEmpty ? null : editor.getHTML()
      onCommit(html)
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.isEmpty ? null : editor.getHTML())
    },
  })

  // Sync external value changes without overwriting active edits
  useEffect(() => {
    if (!editor || isFocusedRef.current) return
    const incoming = value || ''
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
  }, [value, editor])

  // Destroy editor on unmount
  useEffect(
    () => () => {
      editor?.destroy()
    },
    [editor]
  )

  return (
    <>
      <EditorContent editor={editor} />
      {menuElement &&
        editor &&
        createPortal(
          <BubbleMenuBar editor={editor} openLinkInputRef={openLinkInputRef} />,
          menuElement
        )}
    </>
  )
}
