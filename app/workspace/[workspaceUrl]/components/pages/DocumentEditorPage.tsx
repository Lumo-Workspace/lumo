'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DescriptionEditor } from '../DescriptionEditor'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import { ShareDialog } from '../document/ShareDialog'
import { TagPicker } from '../document/TagPicker'
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
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

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onTitleChanged?: (id: string, title: string) => void
  onEmojiChanged?: (id: string, emoji: string | null) => void
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [title, setTitle] = useState(initialCache?.title ?? '')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastContentRef = useRef<string | null>(null)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [docTags, setDocTags] = useState<ApiTag[]>(initialCache?.docTags ?? [])
  const { tags: allTags, createTag } = useTags()

  // Fetch document (background refresh when cache exists)
  useEffect(() => {
    let cancelled = false
    const cached = readCache<ApiDocumentDetail>(
      CACHE_KEY.documentDetail(documentId)
    )

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

  // Auto-save with debounce
  const save = useCallback(
    async (updates: {
      title?: string
      content?: string
      emoji?: string | null
    }) => {
      setSaveStatus('saving')
      try {
        const data = await documentsClient.update<{
          document: Partial<ApiDocumentDetail>
        }>(documentId, updates)
        setSaveStatus('saved')
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000)
        setDoc(prev => {
          const updated = prev ? { ...prev, ...data.document } : prev
          if (updated) writeCache(CACHE_KEY.documentDetail(documentId), updated)
          return updated
        })
      } catch {
        setSaveStatus('error')
      }
    },
    [documentId]
  )

  const debouncedSave = useCallback(
    (updates: { title?: string; content?: string; emoji?: string | null }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => save(updates), 1000)
    },
    [save]
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
      if (saveTimer.current) clearTimeout(saveTimer.current)
      save({ content })
    },
    [save]
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
      save({ emoji })
      onEmojiChanged?.(documentId, emoji)
    },
    [save, onEmojiChanged, documentId]
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
        <div className='text-muted-foreground text-sm'>Document not found</div>
      </div>
    )
  }

  return (
    <>
      <div className='flex-1 overflow-y-auto'>
        <div className='max-w-3xl mx-auto px-8 py-6'>
          {/* Top bar: breadcrumb + share button */}
          <div className='flex items-center justify-between mb-4'>
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
          <div className='flex items-center gap-2.5 text-xs text-muted-foreground mb-4 flex-wrap'>
            {/* Creator */}
            <span className='flex items-center gap-1.5 shrink-0'>
              <span className='size-5 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
                {doc.createdBy.imageUrl ? (
                  <img
                    src={doc.createdBy.imageUrl}
                    alt={doc.createdBy.name}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-[9px] font-medium'>
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
                <span className='border border-border rounded px-2 py-0.5 shrink-0'>
                  {doc.project.name}
                </span>
              </>
            )}

            {/* Editor avatars (if any) */}
            {doc.editors && doc.editors.length > 0 && (
              <>
                <span className='text-border'>·</span>
                <CollaboratorAvatars editors={doc.editors} max={3} size={22} />
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
            placeholder='Type / for commands…'
            documentId={doc.id}
          />
        </div>
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
