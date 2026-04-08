'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
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
  ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Baseline,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ─── Helpers ────────────────────────────────────────────────────────────────────

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

// ─── Main Component ─────────────────────────────────────────────────────────────

export function BubbleMenuBar({
  editor,
  openLinkInputRef,
  onInsertImage,
}: {
  editor: Editor
  openLinkInputRef: React.MutableRefObject<(() => void) | null>
  onInsertImage: () => void
}) {
  const intl = useIntl()
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
          title={intl.formatMessage({ id: 'table.addRowAbove' })}
        >
          <span className='text-[10px] font-semibold leading-none'>↑</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().addRowAfter().run()}
          title={intl.formatMessage({ id: 'table.addRowBelow' })}
        >
          <span className='text-[10px] font-semibold leading-none'>↓</span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          title={intl.formatMessage({ id: 'table.addColLeft' })}
        >
          <span className='text-[10px] font-semibold leading-none'>←</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          title={intl.formatMessage({ id: 'table.addColRight' })}
        >
          <span className='text-[10px] font-semibold leading-none'>→</span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().deleteRow().run()}
          title={intl.formatMessage({ id: 'table.deleteRow' })}
        >
          <span className='text-[10px] font-semibold leading-none text-zinc-500'>
            −R
          </span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().deleteColumn().run()}
          title={intl.formatMessage({ id: 'table.deleteCol' })}
        >
          <span className='text-[10px] font-semibold leading-none text-zinc-500'>
            −C
          </span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().deleteTable().run()}
          title={intl.formatMessage({ id: 'table.deleteTable' })}
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
