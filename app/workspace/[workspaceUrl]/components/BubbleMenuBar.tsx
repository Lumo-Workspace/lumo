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
  ListPlus,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/utils/keyboard'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ToolbarButton, Divider } from './bubble-menu/ToolbarButton'
import { ColorPicker } from './bubble-menu/ColorPicker'
import { AlignMenu } from './bubble-menu/AlignMenu'
import { TableActionsMenu } from './bubble-menu/TableActionsMenu'
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'
import { wrapSelectionWithExtractPending } from './extract/wrapSelection'
import { extractTasks } from '@/lib/api-client/documents-extract'

const TEXT_STYLES = [
  {
    id: 'editor.textStyle.regular',
    action: (e: Editor) => e.chain().focus().setParagraph().run(),
    isActive: (e: Editor) => e.isActive('paragraph'),
  },
  {
    id: 'editor.textStyle.h1',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 1 }),
  },
  {
    id: 'editor.textStyle.h2',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'editor.textStyle.h3',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 3 }),
  },
  {
    id: 'editor.textStyle.h4',
    action: (e: Editor) => e.chain().focus().toggleHeading({ level: 4 }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level: 4 }),
  },
]

const LIST_STYLES = [
  {
    id: 'editor.list.bulleted',
    icon: <List size={14} />,
    action: (e: Editor) => e.chain().focus().toggleBulletList().run(),
    isActive: (e: Editor) => e.isActive('bulletList'),
  },
  {
    id: 'editor.list.numbered',
    icon: <ListOrdered size={14} />,
    action: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e: Editor) => e.isActive('orderedList'),
  },
  {
    id: 'editor.list.checklist',
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
  onRequestComment,
}: {
  editor: Editor
  openLinkInputRef: React.MutableRefObject<(() => void) | null>
  onInsertImage: () => void
  onRequestComment?:
    | ((from: number, to: number, quotedText: string) => void)
    | undefined
}) {
  const intl = useIntl()
  const extractCtx = useDocExtractContext()
  const [styleOpen, setStyleOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const mod = isMac ? '⌘' : 'Ctrl+'
  const styleRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkPanelRef = useRef<HTMLDivElement>(null)

  // Close dropdowns / link panel on outside click
  useEffect(() => {
    if (!styleOpen && !listOpen && !linkOpen) return
    const handler = (e: MouseEvent) => {
      if (!styleRef.current?.contains(e.target as Node)) setStyleOpen(false)
      if (!listRef.current?.contains(e.target as Node)) setListOpen(false)
      if (!linkPanelRef.current?.contains(e.target as Node)) {
        setLinkOpen(false)
        setLinkUrl('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [styleOpen, listOpen, linkOpen])

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
      canMergeCells: ctx.editor.can().mergeCells(),
      canSplitCell: ctx.editor.can().splitCell(),
      selectionEmpty: ctx.editor.state.selection.empty,
      selectionCrossParagraph:
        ctx.editor.state.selection.$from.parent !==
        ctx.editor.state.selection.$to.parent,
      // Only the convert-to-task action consumes this, and canConvert already
      // gates on !!extractCtx — so skip the per-transaction full-doc walk
      // entirely when there's no extract feature mounted.
      selectionHasTaskLink:
        !!extractCtx &&
        (() => {
          const { $from, $to } = ctx.editor.state.selection
          let found = false
          ctx.editor.state.doc.nodesBetween($from.pos, $to.pos, node => {
            if (node.marks.some(m => m.type.name === 'taskLink')) found = true
          })
          return found
        })(),
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

  const canConvert =
    !!extractCtx &&
    !state.selectionEmpty &&
    !state.selectionCrossParagraph &&
    !state.selectionHasTaskLink

  const bubbleLabel = intl.formatMessage({
    id: 'doc.extract.button.bubble',
    defaultMessage: 'Convert to task',
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
      <div
        ref={linkPanelRef}
        className='flex items-center gap-1.5 px-2 py-1 bg-card border border-border rounded-lg shadow-elevation-3'
      >
        <Link2 size={13} className='shrink-0 text-muted-foreground' />
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
          className='w-52 text-caption bg-transparent outline-none text-foreground placeholder:text-muted-foreground'
        />
        <button
          type='button'
          onMouseDown={e => {
            e.preventDefault()
            applyLink()
          }}
          className='text-caption text-muted-foreground hover:text-foreground transition-colors px-1'
        >
          {intl.formatMessage({ id: 'editor.link.apply' })}
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
                className='text-muted-foreground hover:text-destructive transition-colors'
              >
                <Link2Off size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {intl.formatMessage({ id: 'editor.link.remove' })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  // Unified in-table toolbar — stable shape regardless of selection.
  if (state.isTable) {
    return (
      <div className='flex items-center gap-0.5 px-1.5 py-1 bg-card border border-border rounded-lg shadow-elevation-3'>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={state.isBold}
          title={`${intl.formatMessage({ id: 'editor.bold' })} ${mod}B`}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={state.isItalic}
          title={`${intl.formatMessage({ id: 'editor.italic' })} ${mod}I`}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={state.isUnderline}
          title={`${intl.formatMessage({ id: 'editor.underline' })} ${mod}U`}
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={state.isStrike}
          title={intl.formatMessage({ id: 'editor.strikethrough' })}
        >
          <Strikethrough size={14} />
        </ToolbarButton>
        <ColorPicker
          editor={editor}
          currentColor={state.currentColor}
          currentHighlight={state.currentHighlight}
        />

        <Divider />

        <AlignMenu
          editor={editor}
          alignLeft={state.alignLeft}
          alignCenter={state.alignCenter}
          alignRight={state.alignRight}
        />

        <Divider />

        <ToolbarButton
          onClick={openLinkInput}
          active={state.isLink}
          title={`${intl.formatMessage({ id: 'editor.link' })} ${mod}K`}
        >
          <Link2 size={14} />
        </ToolbarButton>

        <Divider />

        <TableActionsMenu
          editor={editor}
          canMergeCells={state.canMergeCells}
          canSplitCell={state.canSplitCell}
        />
      </div>
    )
  }

  return (
    <div className='flex items-center gap-0.5 px-1.5 py-1 bg-card border border-border rounded-lg shadow-elevation-3'>
      {/* Text style dropdown — custom, no portal to avoid first-render position bug */}
      <div ref={styleRef} className='relative'>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              aria-label={intl.formatMessage({ id: activeStyle.id })}
              aria-haspopup='menu'
              aria-expanded={styleOpen}
              onMouseDown={e => {
                e.preventDefault()
                setStyleOpen(o => !o)
              }}
              className='flex items-center gap-1 px-1.5 h-7 rounded-sm text-caption text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors'
            >
              {intl.formatMessage({ id: activeStyle.id })}
              <ChevronDown size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({ id: activeStyle.id })}
          </TooltipContent>
        </Tooltip>
        {styleOpen && (
          <div
            role='menu'
            className='absolute top-full left-0 mt-1 z-dropdown min-w-[140px] bg-popover text-popover-foreground border border-border rounded-md shadow-elevation-3 py-1'
          >
            {TEXT_STYLES.map((style, i) => (
              <button
                key={style.id}
                role='menuitem'
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  style.action(editor)
                  setStyleOpen(false)
                }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-caption transition-colors',
                  activeFlags[i]
                    ? 'bg-accent text-accent-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {intl.formatMessage({ id: style.id })}
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
        title={`${intl.formatMessage({ id: 'editor.bold' })} ${mod}B`}
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={state.isItalic}
        title={`${intl.formatMessage({ id: 'editor.italic' })} ${mod}I`}
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={state.isUnderline}
        title={`${intl.formatMessage({ id: 'editor.underline' })} ${mod}U`}
      >
        <UnderlineIcon size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={openLinkInput}
        active={state.isLink}
        title={`${intl.formatMessage({ id: 'editor.link' })} ${mod}K`}
      >
        <Link2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={state.isStrike}
        title={intl.formatMessage({ id: 'editor.strikethrough' })}
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
        title={intl.formatMessage({ id: 'editor.inlineCode' })}
      >
        <Code size={14} />
      </ToolbarButton>

      {/* Code block */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={state.isCodeBlock}
        title={intl.formatMessage({ id: 'editor.codeBlock' })}
      >
        <Code2 size={14} />
      </ToolbarButton>

      {/* Blockquote */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={state.isBlockquote}
        title={`${intl.formatMessage({ id: 'editor.quote' })} ${isMac ? '⌘⇧B' : 'Ctrl+Shift+B'}`}
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
              aria-label={intl.formatMessage({
                id: state.isOrderedList
                  ? 'editor.list.numbered'
                  : state.isTaskList
                    ? 'editor.list.checklist'
                    : 'editor.list.bulleted',
              })}
              aria-haspopup='menu'
              aria-expanded={listOpen}
              onMouseDown={e => {
                e.preventDefault()
                setListOpen(o => !o)
              }}
              className={cn(
                'flex items-center gap-1 px-1.5 h-7 rounded-sm transition-colors',
                state.isBulletList || state.isOrderedList || state.isTaskList
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <List size={14} />
              <ChevronDown size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({
              id: state.isOrderedList
                ? 'editor.list.numbered'
                : state.isTaskList
                  ? 'editor.list.checklist'
                  : 'editor.list.bulleted',
            })}
          </TooltipContent>
        </Tooltip>
        {listOpen && (
          <div
            role='menu'
            className='absolute top-full left-0 mt-1 z-dropdown min-w-[150px] bg-popover text-popover-foreground border border-border rounded-md shadow-elevation-3 py-1'
          >
            {LIST_STYLES.map(style => {
              const active = style.isActive(editor)
              return (
                <button
                  key={style.id}
                  role='menuitem'
                  type='button'
                  onMouseDown={e => {
                    e.preventDefault()
                    style.action(editor)
                    setListOpen(false)
                  }}
                  className={cn(
                    'w-full text-left flex items-center gap-2 px-3 py-1.5 text-caption transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground font-semibold'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {style.icon}
                  {intl.formatMessage({ id: style.id })}
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
        title={intl.formatMessage({ id: 'editor.insertTable' })}
      >
        <Table2 size={14} />
      </ToolbarButton>

      {/* Insert image */}
      <ToolbarButton
        onClick={onInsertImage}
        title={intl.formatMessage({ id: 'editor.insertImage' })}
      >
        <ImageIcon size={14} />
      </ToolbarButton>

      {extractCtx && (
        <>
          <Divider />

          {/* Convert selected text to task */}
          <ToolbarButton
            onClick={async () => {
              if (!extractCtx) return
              try {
                const content = wrapSelectionWithExtractPending(editor)
                const res = await extractTasks(extractCtx.documentId, {
                  content,
                  selector: { type: 'marked' },
                })
                extractCtx.onApplied(res)
              } catch (err) {
                extractCtx.onError(err as Error)
              }
            }}
            disabled={!canConvert}
            title={bubbleLabel}
          >
            <ListPlus size={14} />
          </ToolbarButton>
        </>
      )}

      {onRequestComment && !state.selectionEmpty && (
        <>
          <Divider />

          {/* Add comment on selected text */}
          <ToolbarButton
            data-testid='bubble-comment'
            onClick={() => {
              const { from, to } = editor.state.selection
              const quotedText = editor.state.doc.textBetween(from, to, ' ')
              onRequestComment(from, to, quotedText)
            }}
            title={intl.formatMessage({ id: 'editor.comment' })}
          >
            <MessageSquare size={14} />
          </ToolbarButton>
        </>
      )}
    </div>
  )
}
