'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DescriptionEditor } from '../DescriptionEditor'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import { ShareDialog } from '../document/ShareDialog'
import type {
  ApiDocumentDetail,
  ApiDocumentAncestor,
  ApiDocumentShare,
  DocVisibility,
  WorkspaceMemberInfo,
} from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onTitleChanged?: (id: string, title: string) => void
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function DocumentEditorPage({
  documentId,
  onNavigateToDocument,
  onNavigateToDocuments,
  onTitleChanged,
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
  const [title, setTitle] = useState(initialCache?.title ?? '')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)

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
    }
    setLoading(!cached)

    async function fetchDocument() {
      try {
        const res = await fetch(API.documents.byId(documentId))
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          const docWithAncestors = {
            ...data.document,
            ancestors: data.ancestors ?? [],
          }
          setDoc(docWithAncestors)
          setTitle(data.document.title)
          setAncestors(data.ancestors ?? [])
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
        const res = await fetch(API.documents.byId(documentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        if (res.ok) {
          setSaveStatus('saved')
          const data = await res.json()
          setDoc(prev => {
            const updated = prev ? { ...prev, ...data.document } : prev
            if (updated)
              writeCache(CACHE_KEY.documentDetail(documentId), updated)
            return updated
          })
        } else {
          setSaveStatus('error')
        }
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
      debouncedSave({ content: html ?? '' })
    },
    [debouncedSave]
  )

  const handleContentCommit = useCallback(
    (html: string | null) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      save({ content: html ?? '' })
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
    },
    [save]
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
          <div className='flex items-center gap-3 text-xs text-muted-foreground mb-6'>
            {doc.project && <span>{doc.project.name}</span>}
            <button
              type='button'
              className='bg-muted rounded px-2 py-0.5 hover:bg-muted/80 transition-colors'
              onClick={() => setShareDialogOpen(true)}
            >
              {doc.visibility}
            </button>
            {saveStatus !== 'idle' && <span>{getSaveStatusText()}</span>}
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
