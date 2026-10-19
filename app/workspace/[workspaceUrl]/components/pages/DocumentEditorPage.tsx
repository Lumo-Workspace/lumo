'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { Link2, History, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DescriptionEditor, type TocItem } from '../DescriptionEditorLazy'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import { ShareDialog } from '../document/ShareDialog'
import { DocumentHistoryModal } from '../documents/DocumentHistoryModal'
import { documentRevisionsApi } from '@/lib/api-client'
import { toast } from 'sonner'
import { TagPicker } from '../document/TagPicker'
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
import { DocumentToc } from '../document/DocumentToc'
import { withTitleRoot } from '@/lib/editor/toc-display'
import { useAutoHideScrollbar } from '../../hooks/useAutoHideScrollbar'
import { useMentionSources } from '../../hooks/useMentionSources'
import { DocumentStatsFooter } from '../document/DocumentStatsFooter'
import type { EditorStats } from '@/lib/editor/reading-stats'
import { cn } from '@/lib/utils'
import { MemberAvatar } from '@/components/MemberAvatar'
import type {
  ApiDocumentDetail,
  ApiDocumentAncestor,
  ApiDocumentShare,
  DocVisibility,
  WorkspaceMemberInfo,
  ApiTag,
} from '../../types'
import { CACHE_KEY } from '../../constants'
import { documentsClient } from '@/lib/api-client'
import { readCache, writeCache } from '../../cache'
import { useTags } from '../../hooks/useTags'
import { useDocTocCollapsed } from '../../hooks/useDocTocCollapsed'
import { useDocumentSave } from '../../hooks/useDocumentSave'
import { isTempDocumentId, isTempToRealSwap } from '../../utils/tempDocId'
import { useDocumentComments } from '../../hooks/useDocumentComments'
import {
  buildCreateCommentPayload,
  newCommentId,
} from '../document/comments/useCreateDocComment'
import { CommentGutter } from '../document/comments/CommentGutter'
import { CommentSheet } from '../document/comments/CommentSheet'
import { NewCommentPopoverPortal } from '../document/comments/NewCommentPopoverPortal'
import { usePusherEvent } from '../../hooks/usePusher'
import { queryKeys } from '@/lib/query/keys'
import { formatRelativeTime } from '@/lib/datetime/relative'
import {
  setActiveEditorAnchor,
  setResolvedEditorAnchors,
  deleteCommentAndStripAnchor,
  reconcileEditorOnDocCommentEvent,
  flashEditorAnchor,
  docCommentEventNeedsRefetch,
} from '../document/comments/anchor-dom'

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onTitleChanged?: (id: string, title: string) => void
  onEmojiChanged?: (id: string, emoji: string | null) => void
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
}

/**
 * Trailing-edge debounce for serializing the document into onChange. Documents
 * can be large, so we keep the full-document getHTML() off the keystroke hot
 * path. On blur the editor drops the pending serialize and onCommit
 * (handleContentCommit → immediate save) finalizes, and the downstream save is
 * debounced separately, so this only governs how often we serialize while
 * actively typing.
 */
const CONTENT_SERIALIZE_DEBOUNCE_MS = 300

export function DocumentEditorPage({
  documentId,
  onNavigateToDocument,
  onNavigateToDocuments,
  onTitleChanged,
  onEmojiChanged,
  members,
  currentMemberId,
}: DocumentEditorPageProps) {
  const intl = useIntl()
  const mentionSources = useMentionSources(members)
  const initialCache = readCache<ApiDocumentDetail>(
    CACHE_KEY.documentDetail(documentId)
  )
  const [doc, setDoc] = useState<ApiDocumentDetail | null>(initialCache)
  const [ancestors, setAncestors] = useState<ApiDocumentAncestor[]>(
    initialCache?.ancestors ?? []
  )
  const [loading, setLoading] = useState(!initialCache)
  const [title, setTitle] = useState(initialCache?.title ?? '')
  const lastContentRef = useRef<string | null>(null)
  // Tracks the id the fetch effect last ran for, so it can detect the
  // temp→real swap render and skip the GET that would race the replayed PATCH
  // (LUM-659). Seeded to the initial id so a first mount is not mistaken for a
  // swap.
  const prevDocumentIdRef = useRef(documentId)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  const [docTags, setDocTags] = useState<ApiTag[]>(initialCache?.docTags ?? [])
  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [stats, setStats] = useState<EditorStats | null>(null)
  // The scroll root needs to be a state value (not just a ref) so child
  // components can react when the DOM node mounts. The Tiptap TableOfContents
  // extension binds its scroll listener once during onCreate, so handing it a
  // function that closes over a still-null ref would silently fall through to
  // window. Storing the node in state lets DescriptionEditor rebind the
  // listener once the real element is available.
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
  const { tags: allTags, createTag } = useTags()
  const { collapsed: tocCollapsed, toggle: toggleToc } = useDocTocCollapsed()
  // Outline scroll container: its scrollbar shows only while scrolling.
  const tocScrollRef = useAutoHideScrollbar<HTMLElement>()

  // ── Actor id for comment author gating ───────────────────────────────────
  // comments compare against comment.authorActorId (an Actor.id), not a
  // Member.id, so we resolve the current member's actorId here.
  const currentActorId =
    members.find(m => m.id === currentMemberId)?.actorId ?? null

  // ── Comments ──────────────────────────────────────────────────────────────
  const editorRef = useRef<import('@tiptap/core').Editor | null>(null)
  // Editor + flex-row exposed as state (not just refs) so the comment gutter
  // re-measures once they mount.
  const [editor, setEditor] = useState<import('@tiptap/core').Editor | null>(
    null
  )
  const [commentRow, setCommentRow] = useState<HTMLDivElement | null>(null)
  const { comments, create, updateComment, deleteComment, setStatus } =
    useDocumentComments(documentId)
  const [pending, setPending] = useState<{
    from: number
    to: number
    quotedText: string
  } | null>(null)

  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  // Narrow-screen (<xl) comments drawer — the gutter rail is hidden there.
  const [commentSheetOpen, setCommentSheetOpen] = useState(false)

  const queryClient = useQueryClient()

  // Realtime: invalidate comments when a comment-related Pusher event arrives,
  // and reconcile the editor on a remote delete — the server already stripped
  // the anchor span from stored content, so drop the matching mark from the open
  // editor or the highlight lingers until a reload (our own delete is handled by
  // handleDeleteComment; this no-ops for it).
  usePusherEvent(
    `document-${documentId}`,
    'document-update',
    (event: { type?: string; commentId?: string }) => {
      if (docCommentEventNeedsRefetch(event)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentComments(documentId),
        })
        reconcileEditorOnDocCommentEvent(editorRef.current, event)
      }
    }
  )

  // Keep the editor anchor highlight in sync with activeCommentId.
  useEffect(() => {
    if (editorRef.current)
      setActiveEditorAnchor(editorRef.current, activeCommentId)
  }, [activeCommentId])

  // Resolved threads keep their span but should drop the body highlight. Re-runs
  // when comments change (resolve/reopen) and when the editor (re)mounts, since
  // a fresh ProseMirror render emits plain spans without the resolved class.
  useEffect(() => {
    if (!editor) return
    const resolvedIds = comments
      .filter(c => c.status === 'RESOLVED')
      .map(c => c.id)
    setResolvedEditorAnchors(editor, resolvedIds)
  }, [comments, editor])

  const scrollToAnchor = useCallback((commentId: string) => {
    const dom = editorRef.current?.view.dom as HTMLElement | undefined
    dom
      ?.querySelector(`span[data-comment-id="${commentId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setActiveCommentId(commentId)
    const editor = editorRef.current
    if (editor) flashEditorAnchor(editor, commentId)
  }, [])

  // Delete a comment, then clear its body highlight from the live editor. The
  // server strips the anchor span from stored content on delete; this drops the
  // matching mark from the open editor so the highlight doesn't linger until a
  // remount. Stripping only after the await resolves keeps a failed delete from
  // orphaning a still-live comment (see deleteCommentAndStripAnchor).
  const handleDeleteComment = useCallback(
    (id: string) =>
      deleteCommentAndStripAnchor(editorRef.current, id, deleteComment),
    [deleteComment]
  )

  // Fetch document (background refresh when cache exists)
  useEffect(() => {
    let cancelled = false
    const prevDocumentId = prevDocumentIdRef.current
    prevDocumentIdRef.current = documentId
    // The optimistic temp id just swapped to the real slug: the created doc is
    // already seeded into cache(realSlug) by the swap handler, and
    // useDocumentSave replays the user's held edits against the real id. A GET
    // here would return the pre-edit template body and race that replay,
    // flashing the editor back to the template (LUM-659). Skip it — normal
    // navigation (real→real, initial load) still fetches below.
    const swappedFromTemp = isTempToRealSwap(prevDocumentId, documentId)
    const cached = readCache<ApiDocumentDetail>(
      CACHE_KEY.documentDetail(documentId)
    )

    // Reset TOC immediately when switching docs. The editor only emits
    // onTocUpdate after it (re)mounts and parses content, so an empty doc
    // would otherwise inherit the previous doc's headings until the next
    // emit — which never comes if there are no headings to find.
    setTocItems([])
    // Same for stats — the editor re-emits once it remounts and parses the new
    // content, so clear stale counts from the previous doc in the meantime.
    setStats(null)

    // When switching documents, seed from cache synchronously.
    if (cached) {
      setDoc(cached)
      setTitle(cached.title)
      setAncestors(cached.ancestors ?? [])
      setDocTags(cached.docTags ?? [])
      lastContentRef.current = cached.content ?? null
    }
    setLoading(!cached)

    async function fetchDocument() {
      try {
        const data = await documentsClient.getById<{
          document: ApiDocumentDetail & { docTags?: ApiTag[] }
          ancestors?: ApiDocumentAncestor[]
        }>(documentId)
        if (!cancelled) {
          const docWithAncestors = {
            ...data.document,
            ancestors: data.ancestors ?? [],
          }
          setDoc(docWithAncestors)
          setTitle(data.document.title)
          setAncestors(data.ancestors ?? [])
          setDocTags(data.document.docTags ?? [])
          lastContentRef.current = data.document.content ?? null
          writeCache(CACHE_KEY.documentDetail(documentId), docWithAncestors)
        }
      } catch {
        // silently handle fetch errors
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    if (swappedFromTemp) {
      // Content is authoritative locally; don't race the replayed PATCH. The
      // swap handler already seeded cache(realSlug), so `doc` is populated.
      setLoading(false)
    } else {
      fetchDocument()
    }

    return () => {
      cancelled = true
    }
  }, [documentId])

  // Merge a server save response into local state + cache. Only invoked for
  // the most-recently-started save (the hook discards stale responses), so a
  // slow earlier request can't clobber newer edits.
  const applyResult = useCallback(
    (partial: Partial<ApiDocumentDetail>) => {
      setDoc(prev => {
        const updated = prev ? { ...prev, ...partial } : prev
        if (updated) writeCache(CACHE_KEY.documentDetail(documentId), updated)
        return updated
      })
    },
    [documentId]
  )

  const reloadDocument = useCallback(async () => {
    try {
      const data = await documentsClient.getById<{
        document: ApiDocumentDetail & { docTags?: ApiTag[] }
        ancestors?: ApiDocumentAncestor[]
      }>(documentId)
      const docWithAncestors = {
        ...data.document,
        ancestors: data.ancestors ?? [],
      }
      setDoc(docWithAncestors)
      setTitle(data.document.title)
      setAncestors(data.ancestors ?? [])
      setDocTags(data.document.docTags ?? [])
      lastContentRef.current = data.document.content ?? null
      writeCache(CACHE_KEY.documentDetail(documentId), docWithAncestors)
    } catch {
      // ignore reload errors
    }
  }, [documentId])

  const { saveStatus, debouncedSave, saveNow, flushAsync } = useDocumentSave({
    documentId,
    applyResult,
    // While the doc is still an optimistic `temp-<uuid>` (created from a
    // template, real doc pending), hold saves — PATCHing the temp id 404s.
    // They replay against the real id once the background create resolves.
    isPending: isTempDocumentId(documentId),
  })

  const handleSubmitComment = useCallback(
    async (body: string) => {
      const editor = editorRef.current
      if (!editor || !pending) return
      // Flush any pending debounced content save so the server has the current
      // (pre-mark) content before we POST the new comment. Without this the
      // server's assertOnlyCommentMarksChanged guard can 400 because the stored
      // doc still has an older version of the text.
      await flushAsync()
      const id = newCommentId()
      const payload = buildCreateCommentPayload(editor, {
        id,
        body,
        from: pending.from,
        to: pending.to,
        quotedText: pending.quotedText,
      })
      setPending(null)
      try {
        await create(payload)
      } catch {
        editor.commands.unsetComment(id)
      }
    },
    [pending, create, flushAsync]
  )

  const handleContentChange = useCallback(
    (html: string | null) => {
      const content = html ?? ''
      if (content === (lastContentRef.current ?? '')) return
      lastContentRef.current = content
      debouncedSave({ content })
    },
    [debouncedSave]
  )

  const handleContentCommit = useCallback(
    (html: string | null) => {
      const content = html ?? ''
      if (content === (lastContentRef.current ?? '')) return
      lastContentRef.current = content
      saveNow({ content })
    },
    [saveNow]
  )

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle)
      debouncedSave({ title: newTitle })
      onTitleChanged?.(documentId, newTitle)
    },
    [debouncedSave, onTitleChanged, documentId]
  )

  const handleEmojiChange = useCallback(
    (emoji: string | null) => {
      setDoc(prev => (prev ? { ...prev, emoji } : prev))
      saveNow({ emoji })
      onEmojiChanged?.(documentId, emoji)
    },
    [saveNow, onEmojiChanged, documentId]
  )

  const handleTagsChange = useCallback(
    async (newTags: ApiTag[]) => {
      const prev = docTags
      setDocTags(newTags)
      try {
        await documentsClient.update(documentId, {
          tagIds: newTags.map(t => t.id),
        })
      } catch {
        setDocTags(prev)
      }
    },
    [documentId, docTags]
  )

  function getSaveStatusText(): string {
    switch (saveStatus) {
      case 'saving':
        return intl.formatMessage({ id: 'documentEditor.saving' })
      case 'saved':
        return intl.formatMessage({ id: 'documentEditor.saved' })
      case 'error':
        return 'Error saving'
      default:
        return ''
    }
  }

  const handleSharesChange = useCallback((newShares: ApiDocumentShare[]) => {
    setDoc(prev => (prev ? { ...prev, shares: newShares } : prev))
  }, [])

  const handleVisibilityChange = useCallback((newVisibility: DocVisibility) => {
    setDoc(prev => (prev ? { ...prev, visibility: newVisibility } : prev))
  }, [])

  const handlePublicTokenChange = useCallback((token: string | null) => {
    setDoc(prev => (prev ? { ...prev, publicToken: token } : prev))
  }, [])

  // First load with no cache at all — full-page loading
  if (loading && !doc) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <div className='animate-pulse text-muted-foreground text-body'>
          Loading...
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <div className='text-muted-foreground text-body'>
          {intl.formatMessage({ id: 'documentEditor.notFound' })}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* `relative` is required: the Tiptap TableOfContents extension compares
          a heading's `offsetTop` against the container's `scrollTop`. Without
          a positioned scroll container the heading's offsetParent walks
          further up the tree, so the two values live in different coordinate
          systems and the active state never advances past the first heading. */}
      <div ref={setScrollRoot} className='relative flex-1 overflow-y-auto'>
        {/* Top bar — spans the full scroll container above the TOC + editor
            so the breadcrumb sits flush against the left edge. `px-2` mirrors
            the 8px gutter the doc tree (or the collapsed-rail) reserves on
            its right edge, so all document pages share a consistent gutter. */}
        <div className='flex items-center justify-between px-2 pt-6 pb-4'>
          <div className='min-w-0'>
            <DocumentBreadcrumb
              ancestors={ancestors}
              current={{
                id: doc.id,
                title: title || doc.title,
                emoji: doc.emoji,
              }}
              onNavigate={id => {
                if (id) onNavigateToDocument(id)
                else onNavigateToDocuments()
              }}
            />
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              className='h-8 rounded-md px-2 text-body text-muted-foreground hover:text-foreground'
              onClick={async () => {
                const label = window.prompt(
                  intl.formatMessage({
                    id: 'documentHistory.namePrompt',
                    defaultMessage: 'Name this version',
                  })
                )
                if (!label || !label.trim()) return
                await flushAsync()
                try {
                  await documentRevisionsApi.createManual(doc.id, {
                    label: label.trim(),
                  })
                  toast.success(
                    intl.formatMessage({
                      id: 'documentHistory.savedVersion',
                      defaultMessage: 'Version saved',
                    })
                  )
                } catch (e) {
                  toast.error(
                    e instanceof Error
                      ? e.message
                      : intl.formatMessage({
                          id: 'documentHistory.saveFailed',
                          defaultMessage: 'Could not save version',
                        })
                  )
                }
              }}
            >
              {intl.formatMessage({
                id: 'documentHistory.saveAsVersion',
                defaultMessage: 'Save as version',
              })}
            </button>
            {/* Comments drawer trigger — narrow screens only; the xl gutter
                rail is hidden below xl, so this is the way to reach threads. */}
            {comments.length > 0 && (
              <Button
                size='sm'
                variant='ghost'
                className='gap-1.5 h-8 xl:hidden'
                onClick={() => setCommentSheetOpen(true)}
              >
                <MessageSquare size={14} />
                {intl.formatMessage({ id: 'document.comments' })}
                {comments.some(c => c.status === 'OPEN') && (
                  <span className='text-muted-foreground'>
                    {comments.filter(c => c.status === 'OPEN').length}
                  </span>
                )}
              </Button>
            )}
            <Button
              size='sm'
              variant='ghost'
              className='gap-1.5 h-8'
              onClick={async () => {
                await flushAsync()
                setHistoryOpen(true)
              }}
            >
              <History size={14} />
              {intl.formatMessage({
                id: 'documentHistory.openButton',
                defaultMessage: 'History',
              })}
            </Button>
            <Button
              size='sm'
              className='gap-1.5 h-8'
              onClick={() => setShareDialogOpen(true)}
            >
              <Link2 size={14} />
              {intl.formatMessage({
                id: 'share.button',
                defaultMessage: 'Share',
              })}
            </Button>
          </div>
        </div>

        {/* Outline (TOC) + content. The TOC is a flush-left sticky rail that
            hugs the scroll container's left edge (matching the breadcrumb
            above) instead of floating in from the centered content column. The
            editor + comments row keeps its own centering in the remaining
            space, so the document body barely moves. */}
        <div className='flex w-full'>
          {/* Left rail — outline (TOC), collapsible. */}
          {tocItems.length > 0 && (
            <aside
              ref={tocScrollRef}
              className={cn(
                'toc-scroll hidden xl:block shrink-0 self-start sticky top-0 max-h-screen overflow-y-auto pt-2 px-2',
                tocCollapsed ? 'w-12' : 'w-60'
              )}
            >
              <DocumentToc
                items={withTitleRoot(tocItems, title)}
                collapsed={tocCollapsed}
                onToggle={toggleToc}
                scrollRoot={scrollRoot}
              />
            </aside>
          )}
          <div
            className='flex mx-auto w-full min-w-0 max-w-[1200px]'
            ref={setCommentRow}
          >
            <div className='flex-1 min-w-0'>
              <div className='max-w-3xl mx-auto px-8 pb-6'>
                {/* Emoji + Title */}
                <div className='flex items-start gap-3 mb-4'>
                  <EmojiPicker value={doc.emoji} onChange={handleEmojiChange} />
                  <input
                    type='text'
                    value={title}
                    onChange={e => handleTitleChange(e.target.value)}
                    className='flex-1 text-display bg-transparent border-none outline-none placeholder:text-muted-foreground'
                    placeholder={intl.formatMessage({
                      id: 'documents.untitled',
                    })}
                  />
                </div>

                {/* Metadata */}
                <div className='flex items-center gap-2 text-caption text-muted-foreground mb-3 flex-wrap'>
                  {/* Creator */}
                  <span className='flex items-center gap-1 shrink-0'>
                    <MemberAvatar
                      name={doc.createdBy.name}
                      imageUrl={doc.createdBy.imageUrl}
                      size='xs'
                    />
                    <span>{doc.createdBy.name}</span>
                  </span>

                  <span className='text-border'>·</span>

                  {/* Updated time / Save status (save status temporarily replaces updated time) */}
                  <span className='shrink-0'>
                    {saveStatus === 'saving' || saveStatus === 'saved'
                      ? getSaveStatusText()
                      : `${intl.formatMessage({ id: 'documentEditor.updated' })} ${formatRelativeTime(doc.updatedAt, intl.locale)}`}
                  </span>

                  {/* Project badge (if linked) */}
                  {doc.project && (
                    <>
                      <span className='text-border'>·</span>
                      <span className='border border-border rounded-sm px-1.5 py-px shrink-0'>
                        {doc.project.name}
                      </span>
                    </>
                  )}

                  {/* Editor avatars (if any) */}
                  {doc.editors && doc.editors.length > 0 && (
                    <>
                      <span className='text-border'>·</span>
                      <CollaboratorAvatars editors={doc.editors} max={3} />
                    </>
                  )}

                  {/* Tags */}
                  {docTags.length > 0 && <span className='text-border'>·</span>}
                  <div className='shrink-0 [&_input]:min-w-[60px] [&_input]:flex-none [&_input]:w-auto'>
                    <TagPicker
                      selectedTags={docTags}
                      allTags={allTags}
                      onChange={handleTagsChange}
                      onCreateTag={createTag}
                    />
                  </div>

                  {/* Save error */}
                  {saveStatus === 'error' && (
                    <>
                      <span className='text-border'>·</span>
                      <span className='italic text-danger-text'>
                        {getSaveStatusText()}
                      </span>
                    </>
                  )}
                </div>

                {/* Editor */}
                <DescriptionEditor
                  key={`editor-${editorReloadKey}`}
                  value={doc.content}
                  onCommit={handleContentCommit}
                  onChange={handleContentChange}
                  onChangeDebounceMs={CONTENT_SERIALIZE_DEBOUNCE_MS}
                  placeholder={intl.formatMessage({
                    id: 'documents.editorPlaceholder',
                    defaultMessage: 'Type / for commands…',
                  })}
                  documentId={doc.id}
                  mentionSources={mentionSources}
                  onTocUpdate={setTocItems}
                  tocScrollRoot={scrollRoot}
                  onStatsUpdate={setStats}
                  onEditorReady={e => {
                    editorRef.current = e
                    setEditor(e)
                  }}
                  onRequestComment={(from, to, quotedText) =>
                    setPending({ from, to, quotedText })
                  }
                  onCommentClick={id => {
                    setActiveCommentId(id)
                  }}
                  commentComposerOpen={!!pending}
                />
              </div>
            </div>

            {/* Right rail — comments gutter (Google-Docs style). */}
            {comments.length > 0 && (
              <aside className='hidden xl:block shrink-0 self-start w-64 pt-2 px-1'>
                <CommentGutter
                  editor={editor}
                  rowEl={commentRow}
                  comments={comments}
                  members={members}
                  currentActorId={currentActorId}
                  activeCommentId={activeCommentId}
                  onReply={(parentId, body) =>
                    create({ id: newCommentId(), body, parentId })
                  }
                  onEdit={(id, body) => updateComment(id, body)}
                  onDelete={handleDeleteComment}
                  onSetStatus={(id, status) => setStatus(id, status)}
                  onSelectThread={scrollToAnchor}
                />
              </aside>
            )}
          </div>
        </div>

        {/* New-comment composer — floats anchored to the selection (portal), so
            it clamps into the viewport and works at every width, unlike the
            xl-only gutter rail. */}
        {pending && editor && (
          <NewCommentPopoverPortal
            editor={editor}
            from={pending.from}
            to={pending.to}
            quotedText={pending.quotedText}
            members={members}
            onCancel={() => setPending(null)}
            onSubmit={handleSubmitComment}
          />
        )}

        {/* Narrow-screen comments drawer (gutter rail is hidden below xl). */}
        <CommentSheet
          open={commentSheetOpen}
          onOpenChange={setCommentSheetOpen}
          comments={comments}
          members={members}
          currentActorId={currentActorId}
          activeCommentId={activeCommentId}
          onReply={(parentId, body) =>
            create({ id: newCommentId(), body, parentId })
          }
          onEdit={(id, body) => updateComment(id, body)}
          onDelete={handleDeleteComment}
          onSetStatus={(id, status) => setStatus(id, status)}
          onSelectThread={scrollToAnchor}
        />

        {/* Word count / character count / reading time — floating pill pinned
            to the bottom-right of the scroll pane (see DocumentStatsFooter).
            Rendered here, as a direct child of the scroll container, so its
            sticky layer anchors to the pane edge rather than the centered
            text column. */}
        <DocumentStatsFooter stats={stats} />
      </div>

      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        documentId={doc.id}
        documentTitle={title || doc.title}
        documentEmoji={doc.emoji}
        visibility={doc.visibility}
        publicToken={doc.publicToken}
        shares={doc.shares}
        owner={doc.createdBy}
        members={members}
        currentMemberId={currentMemberId}
        onSharesChange={handleSharesChange}
        onVisibilityChange={handleVisibilityChange}
        onPublicTokenChange={handlePublicTokenChange}
      />

      <DocumentHistoryModal
        open={historyOpen}
        documentId={doc.id}
        currentHtml={doc.content ?? null}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          setHistoryOpen(false)
          void reloadDocument().then(() => setEditorReloadKey(k => k + 1))
        }}
      />
    </>
  )
}
