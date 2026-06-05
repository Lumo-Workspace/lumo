'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DescriptionEditor, type TocItem } from '../DescriptionEditor'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import { ShareDialog } from '../document/ShareDialog'
import { TagPicker } from '../document/TagPicker'
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
import { DocumentToc } from '../document/DocumentToc'
import { DocumentStatsFooter } from '../document/DocumentStatsFooter'
import type { EditorStats } from '@/lib/editor/reading-stats'
import { cn } from '@/lib/utils'
import { getInitials } from '@/lib/utils/getInitials'
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
import { useDocumentComments } from '../../hooks/useDocumentComments'
import {
  buildCreateCommentPayload,
  newCommentId,
} from '../document/comments/useCreateDocComment'
import { NewCommentPopover } from '../document/comments/NewCommentPopover'
import { DocumentCommentsSidebar } from '../document/comments/DocumentCommentsSidebar'

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onTitleChanged?: (id: string, title: string) => void
  onEmojiChanged?: (id: string, emoji: string | null) => void
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
}

function formatRelativeTime(dateStr: string, locale: string = 'en'): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diffSec < 60) return rtf.format(0, 'second')
  const diffMins = Math.floor(diffSec / 60)
  if (diffMins < 60) return rtf.format(-diffMins, 'minute')
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return rtf.format(-diffHours, 'hour')
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return rtf.format(-diffDays, 'day')
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  })
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
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
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

  // ── Comments ──────────────────────────────────────────────────────────────
  const editorRef = useRef<import('@tiptap/core').Editor | null>(null)
  const { comments, create, updateComment, deleteComment, setStatus } =
    useDocumentComments(documentId)
  const [pending, setPending] = useState<{
    from: number
    to: number
    quotedText: string
  } | null>(null)
  const [rightTab, setRightTab] = useState<'toc' | 'comments'>('toc')
  // When there are no TOC items default to the comments tab so the rail shows
  // something useful right away. User-initiated tab switches are preserved via
  // rightTab; this only affects the effective active tab derived for rendering.
  const activeRightTab: 'toc' | 'comments' =
    tocItems.length === 0 ? 'comments' : rightTab

  const scrollToAnchor = useCallback((commentId: string) => {
    const dom = editorRef.current?.view.dom as HTMLElement | undefined
    dom
      ?.querySelector(`span[data-comment-id="${commentId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // Fetch document (background refresh when cache exists)
  useEffect(() => {
    let cancelled = false
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

    fetchDocument()

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

  const { saveStatus, debouncedSave, saveNow, flushAsync } = useDocumentSave({
    documentId,
    applyResult,
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
        <div className='animate-pulse text-muted-foreground text-sm'>
          Loading...
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <div className='text-muted-foreground text-sm'>
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

        <div className='flex'>
          {/* Right rail — shows TOC (when headings exist) or Comments tab.
              Always rendered when there are headings or comments so the
              Comments tab is reachable even on a heading-free document. */}
          {(tocItems.length > 0 || comments.length > 0) && (
            <aside
              className={cn(
                'hidden xl:block shrink-0 self-start sticky top-0 max-h-screen overflow-y-auto pt-2 px-2',
                tocCollapsed && activeRightTab === 'toc' ? 'w-12' : 'w-52'
              )}
            >
              {/* Tab toggle — Outline / Comments */}
              <div className='mb-2 flex gap-1 border-b pb-1'>
                {tocItems.length > 0 && (
                  <button
                    type='button'
                    onClick={() => setRightTab('toc')}
                    className={cn(
                      'text-xs px-2 py-0.5 rounded',
                      activeRightTab === 'toc'
                        ? 'bg-muted font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {intl.formatMessage({ id: 'document.outline' })}
                  </button>
                )}
                <button
                  type='button'
                  onClick={() => setRightTab('comments')}
                  className={cn(
                    'text-xs px-2 py-0.5 rounded',
                    activeRightTab === 'comments'
                      ? 'bg-muted font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {intl.formatMessage({ id: 'document.comments' })}
                </button>
              </div>

              {activeRightTab === 'toc' && tocItems.length > 0 && (
                <DocumentToc
                  items={tocItems}
                  collapsed={tocCollapsed}
                  onToggle={toggleToc}
                  scrollRoot={scrollRoot}
                />
              )}

              {activeRightTab === 'comments' && (
                <DocumentCommentsSidebar
                  comments={comments}
                  members={members}
                  agentActors={[]}
                  currentActorId={currentMemberId ?? null}
                  onReply={(parentId, body) =>
                    create({ id: newCommentId(), body, parentId })
                  }
                  onEdit={(id, body) => updateComment(id, body)}
                  onDelete={id => deleteComment(id)}
                  onSetStatus={(id, status) => setStatus(id, status)}
                  onSelectThread={scrollToAnchor}
                />
              )}
            </aside>
          )}
          <div className='flex-1 min-w-0'>
            <div className='max-w-3xl mx-auto px-8 pb-6'>
              {/* Emoji + Title */}
              <div className='flex items-start gap-3 mb-4'>
                <EmojiPicker value={doc.emoji} onChange={handleEmojiChange} />
                <input
                  type='text'
                  value={title}
                  onChange={e => handleTitleChange(e.target.value)}
                  className='flex-1 text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground'
                  placeholder={intl.formatMessage({ id: 'documents.untitled' })}
                />
              </div>

              {/* Metadata */}
              <div className='flex items-center gap-2 text-xs text-muted-foreground mb-3 flex-wrap'>
                {/* Creator */}
                <span className='flex items-center gap-1 shrink-0'>
                  <span className='size-4 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
                    {doc.createdBy.imageUrl ? (
                      <img
                        src={doc.createdBy.imageUrl}
                        alt={doc.createdBy.name}
                        className='w-full h-full object-cover'
                      />
                    ) : (
                      <span className='text-[8px] font-medium'>
                        {getInitials(doc.createdBy.name)}
                      </span>
                    )}
                  </span>
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
                    <span className='border border-border rounded px-1.5 py-px shrink-0'>
                      {doc.project.name}
                    </span>
                  </>
                )}

                {/* Editor avatars (if any) */}
                {doc.editors && doc.editors.length > 0 && (
                  <>
                    <span className='text-border'>·</span>
                    <CollaboratorAvatars
                      editors={doc.editors}
                      max={3}
                      size={18}
                    />
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
                    <span className='italic text-destructive'>
                      {getSaveStatusText()}
                    </span>
                  </>
                )}
              </div>

              {/* Editor */}
              <DescriptionEditor
                value={doc.content}
                onCommit={handleContentCommit}
                onChange={handleContentChange}
                onChangeDebounceMs={CONTENT_SERIALIZE_DEBOUNCE_MS}
                placeholder={intl.formatMessage({
                  id: 'documents.editorPlaceholder',
                  defaultMessage: 'Type / for commands…',
                })}
                documentId={doc.id}
                onTocUpdate={setTocItems}
                tocScrollRoot={scrollRoot}
                onStatsUpdate={setStats}
                onEditorReady={e => {
                  editorRef.current = e
                }}
                onRequestComment={(from, to, quotedText) =>
                  setPending({ from, to, quotedText })
                }
              />
              {/* NewCommentPopover — inline below editor; precise anchor to the
                  text selection is a follow-up refinement (Plan #6). */}
              {pending && (
                <div className='mt-2'>
                  <NewCommentPopover
                    open={!!pending}
                    quotedText={pending.quotedText}
                    members={members}
                    onCancel={() => setPending(null)}
                    onSubmit={handleSubmitComment}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

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
    </>
  )
}
