'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { getBaseExtensions } from '@/lib/editor/extensions'
import {
  SlashCommandExtension,
  buildSlashCommandSuggestion,
  type SlashCommandPopupState,
} from '@/lib/editor/slash-command'
import {
  SlashCommandList,
  type SlashCommandListRef,
} from '@/lib/editor/slash-command-list'
import type { WorkspaceMemberInfo, ApiTask } from '../types'
import { buildMentionSuggestion } from './mention-suggestion'
import type { MentionPopupState } from './mention-suggestion'
import { MentionList } from './MentionList'
import type { MentionListRef } from './MentionList'

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
  Table2,
  Trash2,
  ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Baseline,
} from 'lucide-react'
import { toast } from 'sonner'
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

const FONT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Gray', value: '#8c8c8c' },
  { label: 'Red', value: '#d83931' },
  { label: 'Orange', value: '#de7802' },
  { label: 'Yellow', value: '#dc9b04' },
  { label: 'Green', value: '#21a121' },
  { label: 'Blue', value: '#245bdb' },
  { label: 'Purple', value: '#6425d0' },
]

const BG_COLORS_LIGHT = [
  { label: 'None', value: '' },
  { label: 'Light Red', value: '#fde8e8' },
  { label: 'Light Orange', value: '#fef0e1' },
  { label: 'Light Yellow', value: '#fefce8' },
  { label: 'Light Green', value: '#e8fde8' },
  { label: 'Light Blue', value: '#e8f0fe' },
  { label: 'Light Purple', value: '#f0e8fe' },
]

const BG_COLORS_DARK = [
  { label: 'Gray', value: '#e2e2e2' },
  { label: 'Red', value: '#f9b4b4' },
  { label: 'Orange', value: '#fdd09b' },
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Green', value: '#b4f9b4' },
  { label: 'Blue', value: '#b4d0fe' },
  { label: 'Purple', value: '#d0b4fe' },
]

function ColorPicker({
  editor,
  currentColor,
  currentHighlight,
}: {
  editor: Editor
  currentColor: string
  currentHighlight: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className='relative'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center justify-center size-7 rounded transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100'
          >
            <Baseline
              size={14}
              style={{
                color: currentColor || undefined,
                backgroundColor: currentHighlight || undefined,
                borderRadius: currentHighlight ? 2 : undefined,
              }}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>Text color</TooltipContent>
      </Tooltip>
      {open && (
        <div className='absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 w-[200px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-2'>
          {/* Font colors */}
          <div className='text-[10px] font-medium text-muted-foreground mb-1'>
            Font color
          </div>
          <div className='flex gap-1 mb-2'>
            {FONT_COLORS.map(c => (
              <button
                key={c.value || 'default'}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  if (c.value) {
                    editor.chain().focus().setColor(c.value).run()
                  } else {
                    editor.chain().focus().unsetColor().run()
                  }
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center justify-center size-5 rounded text-[11px] font-bold border transition-colors',
                  currentColor === c.value || (!currentColor && !c.value)
                    ? 'border-blue-500'
                    : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
                style={{ color: c.value || undefined }}
                title={c.label}
              >
                A
              </button>
            ))}
          </div>

          {/* Background colors */}
          <div className='text-[10px] font-medium text-muted-foreground mb-1'>
            Background
          </div>
          <div className='flex gap-1 mb-1'>
            {BG_COLORS_LIGHT.map(c => (
              <button
                key={c.value || 'none'}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  if (c.value) {
                    editor
                      .chain()
                      .focus()
                      .setHighlight({ color: c.value })
                      .run()
                  } else {
                    editor.chain().focus().unsetHighlight().run()
                  }
                  setOpen(false)
                }}
                className={cn(
                  'size-5 rounded border transition-colors',
                  currentHighlight === c.value ||
                    (!currentHighlight && !c.value)
                    ? 'border-blue-500'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                )}
                style={{ backgroundColor: c.value || 'transparent' }}
                title={c.label}
              >
                {!c.value && (
                  <span className='block w-full h-full relative'>
                    <span className='absolute inset-0 flex items-center justify-center text-[8px] text-zinc-400'>
                      ∅
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className='flex gap-1 mb-2'>
            {BG_COLORS_DARK.map(c => (
              <button
                key={c.value}
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  editor.chain().focus().setHighlight({ color: c.value }).run()
                  setOpen(false)
                }}
                className={cn(
                  'size-5 rounded border transition-colors',
                  currentHighlight === c.value
                    ? 'border-blue-500'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                )}
                style={{ backgroundColor: c.value }}
                title={c.label}
              />
            ))}
          </div>

          {/* Reset */}
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              editor.chain().focus().unsetColor().unsetHighlight().run()
              setOpen(false)
            }}
            className='w-full text-center text-[11px] text-muted-foreground hover:text-foreground py-1 border-t border-zinc-100 dark:border-zinc-800 transition-colors'
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
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
  onInsertImage,
}: {
  editor: Editor
  openLinkInputRef: React.MutableRefObject<(() => void) | null>
  onInsertImage: () => void
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
      isTable: ctx.editor.isActive('table'),
      selectionEmpty: ctx.editor.state.selection.empty,
      alignLeft: ctx.editor.isActive({ textAlign: 'left' }),
      alignCenter: ctx.editor.isActive({ textAlign: 'center' }),
      alignRight: ctx.editor.isActive({ textAlign: 'right' }),
      currentColor:
        (ctx.editor.getAttributes('textStyle').color as string) ?? '',
      currentHighlight:
        (ctx.editor.getAttributes('highlight').color as string) ?? '',
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

  // Table-only toolbar — shown when cursor is inside a table with no text selected
  if (state.isTable && state.selectionEmpty) {
    return (
      <div className='flex items-center gap-0.5 px-1.5 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg'>
        <ToolbarButton
          onClick={() => editor.chain().focus().addRowBefore().run()}
          title='Add row above'
        >
          <span className='text-[10px] font-semibold leading-none'>↑</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().addRowAfter().run()}
          title='Add row below'
        >
          <span className='text-[10px] font-semibold leading-none'>↓</span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          title='Add column left'
        >
          <span className='text-[10px] font-semibold leading-none'>←</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          title='Add column right'
        >
          <span className='text-[10px] font-semibold leading-none'>→</span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().deleteRow().run()}
          title='Delete row'
        >
          <span className='text-[10px] font-semibold leading-none text-zinc-500'>
            −R
          </span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().deleteColumn().run()}
          title='Delete column'
        >
          <span className='text-[10px] font-semibold leading-none text-zinc-500'>
            −C
          </span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().deleteTable().run()}
          title='Delete table'
        >
          <Trash2 size={13} />
        </ToolbarButton>
      </div>
    )
  }

  // Table inline formatting toolbar — shown when text is selected inside a table
  if (state.isTable && !state.selectionEmpty) {
    return (
      <div className='flex items-center gap-0.5 px-1.5 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg'>
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
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={state.isStrike}
          title='Strikethrough'
        >
          <Strikethrough size={14} />
        </ToolbarButton>
        <ColorPicker
          editor={editor}
          currentColor={state.currentColor}
          currentHighlight={state.currentHighlight}
        />

        <Divider />

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={state.alignLeft}
          title='Align left'
        >
          <AlignLeft size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={state.alignCenter}
          title='Align center'
        >
          <AlignCenter size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={state.alignRight}
          title='Align right'
        >
          <AlignRight size={14} />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={openLinkInput}
          active={state.isLink}
          title={`Link ${mod}K`}
        >
          <Link2 size={14} />
        </ToolbarButton>
      </div>
    )
  }

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
      <ColorPicker
        editor={editor}
        currentColor={state.currentColor}
        currentHighlight={state.currentHighlight}
      />

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

      <Divider />

      {/* Insert table */}
      <ToolbarButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        title='Insert table'
      >
        <Table2 size={14} />
      </ToolbarButton>

      {/* Insert image */}
      <ToolbarButton onClick={onInsertImage} title='Insert image'>
        <ImageIcon size={14} />
      </ToolbarButton>
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
  agentActors?: { actorId: string; name: string }[]
  /** Used as the Blob path segment: documents/{documentId}/… */
  documentId?: string
}

/** Low-level: POST the file to Vercel Blob; returns the public CDN URL or null. */
async function uploadImageFile(
  file: File,
  documentId?: string
): Promise<string | null> {
  const formData = new FormData()
  formData.set('file', file)
  if (documentId) formData.set('folder', documentId)
  const res = await fetch('/api/upload/image', {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) return null
  const data = await res.json()
  return (data.url as string) ?? null
}

/**
 * Insert an image immediately using a local blob URL for instant preview,
 * upload in the background, then swap the src to the real CDN URL when done.
 * On failure, removes the placeholder and shows a toast.
 *
 * Returns a Promise that resolves when the upload is settled (success or fail),
 * so callers can track pending uploads before committing the document.
 */
async function insertImageWithUpload(
  file: File,
  documentId: string | undefined,
  getEditor: () => import('@tiptap/core').Editor | null,
  insertPos?: number
): Promise<void> {
  const tempUrl = URL.createObjectURL(file)
  const ed = getEditor()
  if (!ed) {
    URL.revokeObjectURL(tempUrl)
    return
  }

  // Show the image immediately with the local blob URL
  if (insertPos !== undefined) {
    ed.chain()
      .focus()
      .insertContentAt(insertPos, { type: 'image', attrs: { src: tempUrl } })
      .run()
  } else {
    ed.chain().focus().setImage({ src: tempUrl }).run()
  }

  try {
    const realUrl = await uploadImageFile(file, documentId)
    if (!realUrl) throw new Error('Upload returned no URL')

    // Swap blob URL → CDN URL in the document
    const current = getEditor()
    if (current) {
      let swapped = false
      current.state.doc.descendants((node, pos) => {
        if (swapped) return false
        if (node.type.name === 'image' && node.attrs.src === tempUrl) {
          const tr = current.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            src: realUrl,
          })
          current.view.dispatch(tr)
          swapped = true
          return false
        }
        return true
      })
    }
  } catch {
    // Remove the broken placeholder image
    const current = getEditor()
    if (current) {
      let removed = false
      current.state.doc.descendants((node, pos) => {
        if (removed) return false
        if (node.type.name === 'image' && node.attrs.src === tempUrl) {
          const tr = current.state.tr.delete(pos, pos + node.nodeSize)
          current.view.dispatch(tr)
          removed = true
          return false
        }
        return true
      })
    }
    toast.error('Image upload failed')
  } finally {
    URL.revokeObjectURL(tempUrl)
  }
}

export function DescriptionEditor({
  value,
  onCommit,
  onChange,
  placeholder = 'Add a description…',
  members = [],
  tasks = [],
  agentActors = [],
  documentId,
}: DescriptionEditorProps) {
  const isFocusedRef = useRef(false)
  const openLinkInputRef = useRef<(() => void) | null>(null)
  const mentionListRef = useRef<MentionListRef | null>(null)
  // Ref kept in sync with the editor instance so async upload callbacks can
  // always reach the latest editor without stale closures.
  const editorRef = useRef<import('@tiptap/core').Editor | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  // Track in-flight uploads so we delay onCommit until all are settled.
  const pendingUploadsRef = useRef(0)
  const pendingCommitRef = useRef<(() => void) | null>(null)
  const [mentionPopup, setMentionPopup] = useState<MentionPopupState | null>(
    null
  )
  const [slashPopup, setSlashPopup] = useState<SlashCommandPopupState | null>(
    null
  )
  const slashListRef = useRef<SlashCommandListRef | null>(null)

  // Stable DOM element for the bubble menu (created once, never changes)
  const [menuElement] = useState<HTMLDivElement | null>(() =>
    typeof document !== 'undefined' ? document.createElement('div') : null
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...getBaseExtensions(),
      Placeholder.configure({ placeholder }),
      SlashCommandExtension.configure({
        suggestion: buildSlashCommandSuggestion(
          state => setSlashPopup(state),
          state => setSlashPopup(state),
          () => setSlashPopup(null),
          slashListRef
        ),
      }),
      MentionWithType.configure({
        suggestion: buildMentionSuggestion(
          members,
          tasks,
          agentActors,
          setMentionPopup,
          setMentionPopup,
          () => setMentionPopup(null),
          mentionListRef
        ),
      }),
      ...(menuElement
        ? [
            BubbleMenu.configure({
              element: menuElement,
              shouldShow: ({ editor, state }) => {
                if (!editor.isEditable) return false
                // Always show when cursor is inside a table (for table ops)
                if (editor.isActive('table')) return true
                // Otherwise only show for non-empty text selections
                return !state.selection.empty
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
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        const img = files.find(f => f.type.startsWith('image/'))
        if (!img) return false
        event.preventDefault()
        pendingUploadsRef.current++
        insertImageWithUpload(img, documentId, () => editorRef.current).finally(
          () => {
            pendingUploadsRef.current--
            if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
              pendingCommitRef.current()
              pendingCommitRef.current = null
            }
          }
        )
        return true
      },
    },
    onFocus: () => {
      isFocusedRef.current = true
    },
    onBlur: ({ editor }) => {
      isFocusedRef.current = false
      const commit = () => {
        const html = editor.isEmpty ? null : editor.getHTML()
        onCommit(html)
      }
      if (pendingUploadsRef.current > 0) {
        // Uploads still in flight — defer commit until they all settle so we
        // never write a blob: URL into the database.
        pendingCommitRef.current = commit
      } else {
        commit()
      }
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.isEmpty ? null : editor.getHTML())
    },
  })

  // Keep editorRef in sync so async upload callbacks always reach the latest instance
  useEffect(() => {
    editorRef.current = editor ?? null
  }, [editor])

  // Open the hidden file picker when the toolbar image button is clicked
  const handleInsertImage = useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  // ── Drag-and-drop image upload ─────────────────────────────────────────────
  // React synthetic events are delegated at the React root, so they fire too
  // late to reliably cancel the browser's "open file" navigation. We attach
  // NATIVE listeners with capture:true directly on the drop-zone div so we
  // intercept the event before ProseMirror or the browser can act on it.
  useEffect(() => {
    const el = dropZoneRef.current
    if (!el) return

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        // Prevent default on dragover so the browser allows a custom drop
        // instead of navigating to the file.
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      const img = files.find(f => f.type.startsWith('image/'))
      if (!img) return
      e.preventDefault()
      e.stopPropagation()

      const view = editorRef.current?.view
      const coords = view?.posAtCoords({ left: e.clientX, top: e.clientY })
      const insertPos = coords?.pos

      pendingUploadsRef.current++
      insertImageWithUpload(
        img,
        documentId,
        () => editorRef.current,
        insertPos
      ).finally(() => {
        pendingUploadsRef.current--
        if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
          pendingCommitRef.current()
          pendingCommitRef.current = null
        }
      })
    }

    // capture: true → fires before any child handlers (including ProseMirror)
    el.addEventListener('dragover', onDragOver, true)
    el.addEventListener('drop', onDrop, true)
    return () => {
      el.removeEventListener('dragover', onDragOver, true)
      el.removeEventListener('drop', onDrop, true)
    }
  }, [documentId])

  // Called when the user picks a file from the hidden input
  const handleImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      // Reset so the same file can be picked again
      e.target.value = ''
      pendingUploadsRef.current++
      insertImageWithUpload(file, documentId, () => editorRef.current).finally(
        () => {
          pendingUploadsRef.current--
          if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
            pendingCommitRef.current()
            pendingCommitRef.current = null
          }
        }
      )
    },
    [documentId]
  )

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
      {/* Hidden file picker for toolbar image insertion */}
      <input
        ref={imageInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
        className='hidden'
        onChange={handleImageFileChange}
      />
      {/* Native capture listeners are bound to this div via useEffect above */}
      <div ref={dropZoneRef}>
        <EditorContent editor={editor} />
      </div>
      {menuElement &&
        editor &&
        createPortal(
          <BubbleMenuBar
            editor={editor}
            openLinkInputRef={openLinkInputRef}
            onInsertImage={handleInsertImage}
          />,
          menuElement
        )}
      {mentionPopup &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: mentionPopup.rect.bottom + 6,
              left: mentionPopup.rect.left,
              zIndex: 9999,
            }}
            className='w-[260px] max-h-[320px] overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg'
          >
            <MentionList
              ref={mentionListRef}
              items={mentionPopup.items}
              command={mentionPopup.command}
            />
          </div>,
          document.body
        )}
      {slashPopup &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: slashPopup.rect.left,
              top: slashPopup.rect.bottom + 4,
              zIndex: 9999,
            }}
          >
            <SlashCommandList
              ref={slashListRef}
              items={slashPopup.items}
              command={slashPopup.command}
            />
          </div>,
          document.body
        )}
    </>
  )
}
