'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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
}: DescriptionEditorProps) {
  const intl = useIntl()
  const placeholder =
    placeholderProp ?? intl.formatMessage({ id: 'task.descriptionPlaceholder' })
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
  const tocEnabled = !!onTocUpdate

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
      ...(tocEnabled
        ? [
            TableOfContents.configure({
              onUpdate: (content: TableOfContentData) => {
                onTocUpdateRef.current?.(
                  content.map(item => ({
                    id: item.id,
                    level: item.level,
                    textContent: item.textContent,
                    isActive: item.isActive,
                    itemIndex: item.itemIndex,
                  }))
                )
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
