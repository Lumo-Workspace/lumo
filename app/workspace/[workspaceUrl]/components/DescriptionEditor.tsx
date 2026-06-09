'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import {
  TableOfContents,
  type TableOfContentData,
} from '@tiptap/extension-table-of-contents'
import { getBaseExtensions } from '@/lib/editor/extensions'
import { shouldShowBubble } from '@/lib/editor/bubble-menu-visibility'
import { createDebouncedSerializer } from '@/lib/editor/debounced-serializer'
import {
  DocExtractProvider,
  buildStampPending,
} from '@/lib/editor/doc-extract-context'
import {
  SlashCommandExtension,
  buildSlashCommandSuggestion,
  type SlashCommandPopupState,
} from '@/lib/editor/slash-command'
import {
  SlashCommandList,
  type SlashCommandListRef,
} from '@/lib/editor/slash-command-list'
import { MentionWithType } from '@/lib/editor/nodes/mention-with-type'
import { isMac } from '@/lib/utils/keyboard'
import { commentIdFromEventTarget } from './document/comments/anchor-dom'
import type { ExtractResponse } from '@/lib/api-client/documents-extract'
import { ExtractTasksError } from '@/lib/api-client/documents-extract'
import { useTocSync, type TocItem } from '../hooks/useTocSync'
import { useEditorStats } from '../hooks/useEditorStats'
import { useImageUploads } from '../hooks/useImageUploads'
import type { EditorStats } from '@/lib/editor/reading-stats'
import { buildMentionSuggestion } from './mention-suggestion'
import type { MentionPopupState } from './mention-suggestion'
import type { MentionSources } from '@/types/mention'
import { MentionList } from './MentionList'
import type { MentionListRef } from './MentionList'
import { EditorSuggestionPopup } from './EditorSuggestionPopup'
import { BubbleMenuBar } from './BubbleMenuBar'
import { TableInsertHandles } from './table/TableInsertHandles'
import { BatchExtractButton } from './extract/BatchExtractButton'
import { toast } from 'sonner'

// ─── Main editor ───────────────────────────────────────────────────────────────

export type { TocItem }

interface DescriptionEditorProps {
  value: string | null
  onCommit: (html: string | null) => void
  onChange?: (html: string | null) => void
  placeholder?: string
  mentionSources?: MentionSources
  /** Used as the Blob path segment: documents/{documentId}/… */
  documentId?: string
  /**
   * When provided, enables the Table of Contents extension and reports
   * heading items so a parent can render a TOC sidebar. Headings are
   * tagged with `data-toc-id` so callers can `scrollIntoView()` them.
   */
  onTocUpdate?: (items: TocItem[]) => void
  /**
   * Element that owns the editor's vertical scroll. The TableOfContents
   * extension binds its scroll listener here so the "active heading" state
   * stays in sync as the user scrolls. Pass the actual DOM node (not a
   * function) — we manually rebind the listener whenever this changes
   * because the upstream extension only reads `scrollParent` once during
   * onCreate, when the parent ref is typically still null.
   */
  tocScrollRoot?: HTMLElement | null
  /**
   * Debounce window (ms) for serializing the document into the `onChange`
   * callback. Defaults to `0` = eager: `getHTML()` runs on every keystroke,
   * preserving the original contract. Large-document callers (e.g. the doc
   * editor) can opt into a trailing-edge debounce so the expensive full-document
   * serialization stays off the hot keystroke path. The debounced `onChange` is
   * a live/draft channel only: on blur the pending value is cancelled and the
   * authoritative `onCommit` (always called with the latest `getHTML()`)
   * finalizes. Leave unset for small editors (comments) where a debounce would
   * risk a stale read on focused keyboard-submit and saves nothing.
   */
  onChangeDebounceMs?: number
  /**
   * When provided, reports word / character / reading-time stats so a parent
   * can render a footer (see {@link useEditorStats}). Character count comes
   * from the CharacterCount extension; the CJK-aware word count + reading time
   * are derived from the editor's plain text. Recomputes are debounced to stay
   * off the keystroke hot path.
   */
  onStatsUpdate?: (stats: EditorStats) => void
  /**
   * When provided, a "Comment" button appears in the bubble menu whenever the
   * user has a non-empty selection. On click it receives the selection range
   * and the quoted text so a caller can open a comment thread UI.
   * Task-description editors omit this prop, so the button will not render there.
   */
  onRequestComment?: (from: number, to: number, quotedText: string) => void
  /**
   * Called once with the Tiptap `Editor` instance as soon as it is ready.
   * Use this to apply programmatic marks (e.g. comment highlights) from a
   * parent without needing to reach into DescriptionEditor's internals.
   * The prop is optional so all existing callers are unaffected.
   */
  onEditorReady?: (editor: import('@tiptap/core').Editor) => void
  /**
   * Called when the user clicks on a comment-marked span in the editor.
   * Receives the comment id so a parent can highlight the matching thread
   * in the sidebar and switch to the comments tab.
   */
  onCommentClick?: (commentId: string) => void
  /**
   * When true, the selection bubble menu is force-hidden. The document editor
   * sets this while the new-comment composer is open over the same selection so
   * the two floating layers don't overlap.
   */
  commentComposerOpen?: boolean
}

export function DescriptionEditor({
  value,
  onCommit,
  onChange,
  placeholder: placeholderProp,
  mentionSources,
  documentId,
  onTocUpdate,
  tocScrollRoot,
  onChangeDebounceMs,
  onStatsUpdate,
  onRequestComment,
  onEditorReady,
  onCommentClick,
  commentComposerOpen = false,
}: DescriptionEditorProps) {
  const intl = useIntl()
  const router = useRouter()
  const placeholder =
    placeholderProp ?? intl.formatMessage({ id: 'task.descriptionPlaceholder' })
  // Tiptap extensions are configured once at editor creation, so the initial
  // placeholder string would be frozen at first render (when IntlWrapper
  // forces `locale='en'` to avoid hydration mismatch). Route through a ref so
  // the Placeholder extension reads the current value every time it renders
  // its decoration.
  const placeholderRef = useRef(placeholder)
  placeholderRef.current = placeholder
  const isFocusedRef = useRef(false)
  const openLinkInputRef = useRef<(() => void) | null>(null)
  const mentionListRef = useRef<MentionListRef | null>(null)
  // Ref kept in sync with the editor instance so async upload callbacks can
  // always reach the latest editor without stale closures.
  const editorRef = useRef<import('@tiptap/core').Editor | null>(null)
  const { enqueueImageUpload, runOrDeferCommit } = useImageUploads({
    editorRef,
    documentId,
  })
  const imageInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  // Fire undo-warning toast only once per session
  const hasShownUndoWarning = useRef(false)
  const [mentionPopup, setMentionPopup] = useState<MentionPopupState | null>(
    null
  )
  const [slashPopup, setSlashPopup] = useState<SlashCommandPopupState | null>(
    null
  )
  const slashListRef = useRef<SlashCommandListRef | null>(null)

  // Stable ref for onTocUpdate so the extension config (created once) always
  // calls the latest prop without needing to re-init the editor.
  const onTocUpdateRef = useRef(onTocUpdate)
  // Stable ref so the (created-once) extension config can always reach the
  // latest scroll container.
  const tocScrollRootRef = useRef(tocScrollRoot)
  // Ref the extension's onUpdate calls into. We compute the active heading
  // ourselves instead of trusting Tiptap's built-in scroll math, because
  // Tiptap's check (`scrollTop >= offsetTop`) can never highlight the last
  // heading once the container has scrolled to its bottom — the heading still
  // sits below scrollTop, just not far enough to make the container scroll any
  // further. Mirror effects + the big TOC effect live in useTocSync below.
  const emitTocRef = useRef<(data?: TableOfContentData) => void>(() => {})
  const tocEnabled = !!onTocUpdate

  // Ref the stats hook points at its live emitter, so the value-sync effect and
  // extract-applied handler below can refresh the footer after a programmatic
  // setContent({ emitUpdate: false }), which skips the editor's update event.
  const emitStatsRef = useRef<() => void>(() => {})
  const statsEnabled = !!onStatsUpdate

  // Stable DOM element for the bubble menu (created once, never changes)
  const [menuElement] = useState<HTMLDivElement | null>(() =>
    typeof document !== 'undefined' ? document.createElement('div') : null
  )

  // Keep the latest onChange reachable from the (created-once) editor callbacks.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Stable ref for onCommentClick so the (created-once) editorProps closure
  // always calls the latest callback without stale-closure issues.
  const onCommentClickRef = useRef(onCommentClick)
  useEffect(() => {
    onCommentClickRef.current = onCommentClick
  }, [onCommentClick])

  // The BubbleMenu's shouldShow closure is created once at editor construction,
  // so route the composer-open flag through a ref it can read live. Toggling it
  // alone won't re-run shouldShow (no editor transaction fires), so dispatch an
  // empty transaction to force the bubble plugin to re-evaluate immediately.
  const suppressBubbleRef = useRef(false)

  // Coalesce the expensive full-document getHTML() out of the per-keystroke hot
  // path. The serializer reads the *latest* editor lazily (only when a pending
  // change flushes) so a doc-switch never serializes a stale instance.
  // Recreated only when the debounce window changes; a ref keeps the once-built
  // editor callbacks pointing at the current instance.
  const serializer = useMemo(
    () =>
      createDebouncedSerializer(
        () => {
          const ed = editorRef.current
          return !ed || ed.isEmpty ? null : ed.getHTML()
        },
        html => onChangeRef.current?.(html),
        onChangeDebounceMs ?? 0
      ),
    [onChangeDebounceMs]
  )
  const serializerRef = useRef(serializer)
  serializerRef.current = serializer
  // Drop any pending timer when the serializer is replaced (debounce prop
  // changed) or on unmount, so it can never fire into a torn-down editor.
  useEffect(() => () => serializer.cancel(), [serializer])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...getBaseExtensions(),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      SlashCommandExtension.configure({
        suggestion: buildSlashCommandSuggestion(
          state => setSlashPopup(state),
          state => setSlashPopup(state),
          () => setSlashPopup(null),
          slashListRef,
          id => intl.formatMessage({ id })
        ),
      }),
      ...(mentionSources
        ? [
            MentionWithType.configure({
              suggestion: buildMentionSuggestion(
                mentionSources,
                setMentionPopup,
                setMentionPopup,
                () => setMentionPopup(null),
                mentionListRef
              ),
            }),
          ]
        : []),
      ...(menuElement
        ? [
            BubbleMenu.configure({
              element: menuElement,
              shouldShow: ({ editor, state }) =>
                shouldShowBubble({
                  editable: editor.isEditable,
                  isInTable: editor.isActive('table'),
                  selectionEmpty: state.selection.empty,
                  suppressed: suppressBubbleRef.current,
                }),
            }),
          ]
        : []),
      ...(tocEnabled
        ? [
            TableOfContents.configure({
              // Tiptap's scrollHandler still fires on its window listener
              // and writes into storage.content. We don't trust its
              // `isActive`, so onUpdate hands our own emitter the fresh heading
              // list, from which we re-derive the active heading at the current
              // scrollTop. We pass `data` through (rather than letting emit
              // re-read editor.storage) because the extension fires onUpdate
              // *before* it assigns storage.content, so a storage read here is
              // stale — which left the outline blank on reopen until the first
              // scroll. See useTocSync emit() for the full rationale.
              scrollParent: () => tocScrollRootRef.current ?? window,
              onUpdate: data => emitTocRef.current(data),
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
      handleClick: (_view, _pos, event) => {
        const id = commentIdFromEventTarget(event.target as Node | null)
        if (id) onCommentClickRef.current?.(id)
        return false
      },
      handleKeyDown: (_, event) => {
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
        // The pasted file is an image attempt — claim the event before
        // ProseMirror's default handler runs, then validate (size + MIME
        // whitelist) inside enqueueImageUpload, which toasts on rejection.
        event.preventDefault()
        enqueueImageUpload(img)
        return true
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const target = (event.target as HTMLElement | null)?.closest(
            '[data-mention-type]'
          )
          if (!target) return false
          const href = target.getAttribute('data-href')
          const type = target.getAttribute('data-mention-type')
          if (href && type && type !== 'user') {
            event.preventDefault()
            router.push(href)
            return true
          }
          return false
        },
      },
    },
    onFocus: () => {
      isFocusedRef.current = true
    },
    onBlur: ({ editor }) => {
      isFocusedRef.current = false
      // Drop any pending debounced onChange — the onCommit below is the
      // authoritative finalize and always reads the latest getHTML(). Flushing
      // instead would deliver the same content through onChange first, which a
      // dedupe-on-last-value commit handler would then treat as a no-op and skip
      // the immediate save.
      serializerRef.current.cancel()
      runOrDeferCommit(() => {
        const html = editor.isEmpty ? null : editor.getHTML()
        onCommit(html)
      })
    },
    onUpdate: () => {
      // Route serialization through the serializer so getHTML() stays off the
      // keystroke hot path when a caller opts into onChangeDebounceMs. Skipped
      // when there's no onChange listener (the optional call would no-op, and we
      // must not pay for getHTML() — matching the original short-circuit).
      if (onChangeRef.current) serializerRef.current.schedule()
    },
  })

  // Keep editorRef in sync so async upload callbacks always reach the latest instance
  useEffect(() => {
    editorRef.current = editor ?? null
  }, [editor])

  // Notify parent that the editor instance is ready. Fires once the editor
  // transitions from null → instance, giving callers a stable handle to apply
  // programmatic marks (e.g. comment highlights) without internal coupling.
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
  }, [editor, onEditorReady])

  // Hide/restore the bubble menu when the comment composer opens/closes. The
  // ref feeds shouldShow; the empty dispatch forces the bubble plugin to
  // re-evaluate it now rather than on the next selection change.
  useEffect(() => {
    suppressBubbleRef.current = commentComposerOpen
    if (editor) editor.view.dispatch(editor.state.tr)
  }, [commentComposerOpen, editor])

  // Sync the TOC: wire the scroll listener, compute active heading, push items
  // upstream. Mirror effects for onTocUpdateRef/tocScrollRootRef also live here.
  useTocSync({
    editor,
    tocEnabled,
    tocScrollRoot,
    onTocUpdate,
    onTocUpdateRef,
    tocScrollRootRef,
    emitTocRef,
  })

  // Feed word / character / reading-time stats to a parent footer.
  useEditorStats({
    editor,
    enabled: statsEnabled,
    onStatsUpdate,
    emitStatsRef,
  })

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

      enqueueImageUpload(img, insertPos)
    }

    // capture: true → fires before any child handlers (including ProseMirror)
    el.addEventListener('dragover', onDragOver, true)
    el.addEventListener('drop', onDrop, true)
    return () => {
      el.removeEventListener('dragover', onDragOver, true)
      el.removeEventListener('drop', onDrop, true)
    }
  }, [enqueueImageUpload])

  // Called when the user picks a file from the hidden input
  const handleImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      // Reset so the same file can be picked again
      e.target.value = ''
      enqueueImageUpload(file)
    },
    [enqueueImageUpload]
  )

  // Force the Placeholder decoration to redraw whenever the resolved string
  // changes (e.g. locale switches from the SSR-safe 'en' to the user's
  // preferred locale on mount). Dispatching an empty transaction is the
  // documented way to invalidate decorations without touching content.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr)
  }, [placeholder, editor])

  // Sync external value changes without overwriting active edits
  useEffect(() => {
    if (!editor || isFocusedRef.current) return
    const incoming = value || ''
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, { emitUpdate: false })
      // setContent with emitUpdate:false intentionally skips the editor's
      // onUpdate (avoids a write-back loop), but that also skips the
      // TableOfContents extension's onUpdate which drives our emitter. Push
      // a fresh TOC ourselves so the sidebar populates on doc switch instead
      // of staying empty until the first scroll.
      emitTocRef.current()
      // Same reasoning for the stats footer: emitUpdate:false skips the
      // update event the stats hook listens to, so push a fresh count here.
      emitStatsRef.current()
    }
  }, [value, editor])

  // Destroy editor on unmount
  useEffect(
    () => () => {
      editor?.destroy()
    },
    [editor]
  )

  // Called by extract buttons after the server returns updated content.
  // Pushes the new HTML into the editor, triggers an immediate save,
  // and shows user-facing toasts for created/skipped counts.
  const handleExtractApplied = useCallback(
    (response: ExtractResponse) => {
      if (!editor) return
      editor.commands.setContent(response.updatedContent, { emitUpdate: false })
      // emitUpdate:false skips the stats hook's update listener — refresh now.
      emitStatsRef.current()
      const html = editor.isEmpty ? null : editor.getHTML()
      onCommit(html)

      if (!hasShownUndoWarning.current) {
        toast.info(
          intl.formatMessage({
            id: 'doc.extract.undo_warning',
            defaultMessage:
              'Tasks are kept even if you undo. Remove them in the task list.',
          }),
          { duration: 6000 }
        )
        hasShownUndoWarning.current = true
      }

      toast.success(
        intl.formatMessage(
          {
            id: 'doc.extract.toast.success',
            defaultMessage:
              'Created {count, plural, one {1 task} other {# tasks}}.',
          },
          { count: response.tasks.length }
        )
      )

      const emptySkips = response.skipped.filter(
        s => s.reason === 'empty'
      ).length
      if (emptySkips > 0) {
        toast.info(
          intl.formatMessage(
            {
              id: 'doc.extract.toast.skipped_empty',
              defaultMessage:
                'Skipped {count, plural, one {1 empty item} other {# empty items}}.',
            },
            { count: emptySkips }
          )
        )
      }

      const truncated = response.skipped.filter(
        s => s.reason === 'too_long'
      ).length
      if (truncated > 0) {
        toast.info(
          intl.formatMessage(
            {
              id: 'doc.extract.toast.truncated',
              defaultMessage:
                '{count, plural, one {1 task had its title truncated} other {# tasks had their titles truncated}} — see task descriptions.',
            },
            { count: truncated }
          )
        )
      }
    },
    [editor, onCommit, intl]
  )

  const handleExtractError = useCallback(
    (err: Error) => {
      if (err instanceof ExtractTasksError) {
        if (err.code === 'MISSING_PROJECT') {
          toast.error(
            intl.formatMessage({
              id: 'doc.extract.toast.error_no_project',
              defaultMessage:
                'This doc has no project. Tasks need a project — set one in doc settings.',
            })
          )
          return
        }
        if (err.status === 409) {
          // NO_CANDIDATES — happens when batch is clicked with nothing matching;
          // silently ignore (the button shouldn't even be visible at 0 count)
          return
        }
      }
      toast.error(
        intl.formatMessage({
          id: 'doc.extract.toast.error_unknown',
          defaultMessage: 'Could not extract tasks. Try again or refresh.',
        })
      )
    },
    [intl]
  )

  // Stable function for stamping extractPending on a node and serializing HTML.
  // Recomputed only when the editor instance changes.
  const stampPendingOnThisNode = useMemo(
    () => (editor ? buildStampPending(editor) : () => ''),
    [editor]
  )

  const editorContent = (
    <>
      {/* Hidden file picker for toolbar image insertion */}
      <input
        ref={imageInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
        className='hidden'
        onChange={handleImageFileChange}
      />
      {/* Native capture listeners are bound to this div via useEffect above.
          `relative` so TableInsertHandles can absolutely-position its markers. */}
      <div ref={dropZoneRef} className='relative'>
        <EditorContent editor={editor} />
        {editor && editor.isEditable && (
          <TableInsertHandles editor={editor} containerRef={dropZoneRef} />
        )}
      </div>
      {menuElement &&
        editor &&
        createPortal(
          <BubbleMenuBar
            editor={editor}
            openLinkInputRef={openLinkInputRef}
            onInsertImage={handleInsertImage}
            onRequestComment={onRequestComment}
          />,
          menuElement
        )}
      {mentionPopup && (
        <EditorSuggestionPopup
          anchorRect={mentionPopup.rect}
          className='w-[260px] max-h-[320px] overflow-y-auto bg-card border border-border rounded-lg shadow-elevation-3'
        >
          <MentionList
            ref={mentionListRef}
            items={mentionPopup.items}
            loading={mentionPopup.loading}
            command={mentionPopup.command}
          />
        </EditorSuggestionPopup>
      )}
      {slashPopup && (
        <EditorSuggestionPopup anchorRect={slashPopup.rect}>
          <SlashCommandList
            ref={slashListRef}
            items={slashPopup.items}
            command={slashPopup.command}
            label={intl.formatMessage({ id: 'slash.label' })}
          />
        </EditorSuggestionPopup>
      )}
    </>
  )

  // Wrap with DocExtractProvider when we're editing a document (documentId is
  // provided) and the editor is ready. This provides context for per-row hover
  // extract buttons rendered by TaskItemNodeView.
  if (editor && documentId) {
    return (
      <DocExtractProvider
        value={{
          documentId,
          editor,
          onApplied: handleExtractApplied,
          onError: handleExtractError,
          // buildStampPending returns a stable function that closes over the
          // editor instance. Re-compute only when editor identity changes.
          stampPendingOnThisNode,
        }}
      >
        <BatchExtractButton editor={editor} />
        {editorContent}
      </DocExtractProvider>
    )
  }

  return editorContent
}
