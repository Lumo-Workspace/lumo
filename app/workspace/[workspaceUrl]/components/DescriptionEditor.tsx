'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import {
  TableOfContents,
  type TableOfContentData,
} from '@tiptap/extension-table-of-contents'
import { getBaseExtensions } from '@/lib/editor/extensions'
import { createDebouncedSerializer } from '@/lib/editor/debounced-serializer'
import {
  DocExtractProvider,
  buildStampPending,
} from '@/lib/editor/doc-extract-context'
import type { ExtractResponse } from '@/lib/api-client/documents-extract'
import { ExtractTasksError } from '@/lib/api-client/documents-extract'
import { imagesClient } from '@/lib/api-client'
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
import { BubbleMenuBar } from './BubbleMenuBar'
import { BatchExtractButton } from './extract/BatchExtractButton'

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
import { toast } from 'sonner'

// ─── Main editor ───────────────────────────────────────────────────────────────

export type TocItem = {
  id: string
  level: number
  textContent: string
  isActive: boolean
  itemIndex: number
}

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
}

/** Low-level: POST the file to Vercel Blob; returns the public CDN URL or null. */
async function uploadImageFile(
  file: File,
  documentId?: string
): Promise<string | null> {
  try {
    const { url } = await imagesClient.upload(file, documentId)
    return url ?? null
  } catch {
    return null
  }
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
  insertPos?: number,
  errorMessage?: string
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
    toast.error(errorMessage ?? 'Image upload failed')
  } finally {
    URL.revokeObjectURL(tempUrl)
  }
}

export function DescriptionEditor({
  value,
  onCommit,
  onChange,
  placeholder: placeholderProp,
  members = [],
  tasks = [],
  agentActors = [],
  documentId,
  onTocUpdate,
  tocScrollRoot,
  onChangeDebounceMs,
}: DescriptionEditorProps) {
  const intl = useIntl()
  const placeholder =
    placeholderProp ?? intl.formatMessage({ id: 'task.descriptionPlaceholder' })
  // Tiptap extensions are configured once at editor creation, so the initial
  // placeholder string would be frozen at first render (when IntlWrapper
  // forces `locale='en'` to avoid hydration mismatch). Route through a ref so
  // the Placeholder extension reads the current value every time it renders
  // its decoration.
  const placeholderRef = useRef(placeholder)
  placeholderRef.current = placeholder
  const imageUploadFailedMsg = intl.formatMessage({
    id: 'task.imageUploadFailed',
  })
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
  useEffect(() => {
    onTocUpdateRef.current = onTocUpdate
  }, [onTocUpdate])
  // Stable ref so the (created-once) extension config can always reach the
  // latest scroll container.
  const tocScrollRootRef = useRef(tocScrollRoot)
  useEffect(() => {
    tocScrollRootRef.current = tocScrollRoot
  }, [tocScrollRoot])
  // Ref the extension's onUpdate calls into. We compute the active heading
  // ourselves (see the rebind effect below) instead of trusting Tiptap's
  // built-in scroll math, because Tiptap's check (`scrollTop >= offsetTop`)
  // can never highlight the last heading once the container has scrolled to
  // its bottom — the heading still sits below scrollTop, just not far enough
  // to make the container scroll any further.
  const emitTocRef = useRef<() => void>(() => {})
  const tocEnabled = !!onTocUpdate

  // Stable DOM element for the bubble menu (created once, never changes)
  const [menuElement] = useState<HTMLDivElement | null>(() =>
    typeof document !== 'undefined' ? document.createElement('div') : null
  )

  // Keep the latest onChange reachable from the (created-once) editor callbacks.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
      ...(tocEnabled
        ? [
            TableOfContents.configure({
              // Tiptap's scrollHandler still fires on its window listener
              // and writes into storage.content. We don't trust its
              // `isActive`, so onUpdate just nudges our own emitter which
              // re-derives the active heading from the current scrollTop.
              scrollParent: () => tocScrollRootRef.current ?? window,
              onUpdate: () => emitTocRef.current(),
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
        insertImageWithUpload(
          img,
          documentId,
          () => editorRef.current,
          undefined,
          imageUploadFailedMsg
        ).finally(() => {
          pendingUploadsRef.current--
          if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
            pendingCommitRef.current()
            pendingCommitRef.current = null
          }
        })
        return true
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

  // Compute the active heading ourselves and push the TOC items upstream.
  //
  // Why not use Tiptap's built-in active state? It only marks a heading
  // active when `scrollTop >= heading.offsetTop`. Once the container has
  // scrolled to its bottom, the last heading still sits below scrollTop —
  // the container literally cannot scroll any further — so the highlight
  // gets stuck on whichever heading happens to be flush with the top edge.
  //
  // This effect (re)wires three things:
  //   1. `emitTocRef` — called by the extension's onUpdate when the heading
  //      list changes (typing a new heading), and by our own scroll listener.
  //   2. A scroll listener on the real container so we re-emit on scroll.
  //   3. Removal of the extension's window-bound listener that would
  //      otherwise fire onUpdate with stale active states.
  useEffect(() => {
    if (!tocEnabled || !editor) return

    const ACTIVE_OFFSET = 80 // px below container top that still counts as "at the top"

    const emit = () => {
      const tocStorage = editor.storage.tableOfContents as
        | { content?: TableOfContentData }
        | undefined
      const items = tocStorage?.content ?? []
      if (!items.length) {
        onTocUpdateRef.current?.([])
        return
      }

      const root = tocScrollRootRef.current
      let activeIdx = -1
      if (root) {
        const scrollTop = root.scrollTop
        const atBottom = scrollTop + root.clientHeight >= root.scrollHeight - 2
        if (atBottom) {
          activeIdx = items.length - 1
        } else {
          items.forEach((item, i) => {
            const el = root.querySelector(
              `[data-toc-id="${item.id}"]`
            ) as HTMLElement | null
            if (el && el.offsetTop <= scrollTop + ACTIVE_OFFSET) {
              activeIdx = i
            }
          })
        }
      }
      // Fallback to the first heading when no candidate has crossed the
      // threshold yet — at scrollTop = 0 the first heading lives below the
      // title/metadata block, so its offsetTop is greater than the threshold
      // and the loop above leaves activeIdx at -1, which would mean "nothing
      // highlighted" even though the user is clearly reading the top section.
      if (activeIdx === -1) activeIdx = 0

      onTocUpdateRef.current?.(
        items.map((item, i) => ({
          id: item.id,
          level: item.level,
          textContent: item.textContent,
          isActive: i === activeIdx,
          itemIndex: item.itemIndex,
        }))
      )
    }

    emitTocRef.current = emit

    // The extension auto-attaches its own scrollHandler to window during
    // onCreate. Detach it so it doesn't push stale `isActive` values that
    // race with ours.
    const tocStorage = editor.storage.tableOfContents as
      | { scrollHandler?: () => void }
      | undefined
    if (typeof tocStorage?.scrollHandler === 'function') {
      window.removeEventListener('scroll', tocStorage.scrollHandler)
    }

    if (!tocScrollRoot) {
      emit()
      return
    }

    tocScrollRoot.addEventListener('scroll', emit, { passive: true })
    emit()

    return () => {
      tocScrollRoot.removeEventListener('scroll', emit)
    }
  }, [editor, tocEnabled, tocScrollRoot])

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
        insertPos,
        imageUploadFailedMsg
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
      insertImageWithUpload(
        file,
        documentId,
        () => editorRef.current,
        undefined,
        imageUploadFailedMsg
      ).finally(() => {
        pendingUploadsRef.current--
        if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
          pendingCommitRef.current()
          pendingCommitRef.current = null
        }
      })
    },
    [documentId]
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
