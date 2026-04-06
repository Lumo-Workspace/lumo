'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { DescriptionEditor } from '../DescriptionEditor'
import { DocumentTOC } from '../document/DocumentTOC'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import type { ApiDocumentDetail, ApiDocument } from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onCreateChildDocument: (parentId: string) => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function DocumentEditorPage({
  documentId,
  onNavigateToDocument,
  onNavigateToDocuments,
  onCreateChildDocument,
}: DocumentEditorPageProps) {
  const intl = useIntl()
  const initialCache = readCache<ApiDocumentDetail>(
    CACHE_KEY.documentDetail(documentId)
  )
  const [doc, setDoc] = useState<ApiDocumentDetail | null>(initialCache)
  const [loading, setLoading] = useState(!initialCache)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [title, setTitle] = useState(initialCache?.title ?? '')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch document (background refresh when cache exists)
  useEffect(() => {
    let cancelled = false
    const cached = readCache<ApiDocumentDetail>(
      CACHE_KEY.documentDetail(documentId)
    )

    // When switching documents, seed from cache synchronously
    if (cached) {
      setDoc(cached)
      setTitle(cached.title)
      setLoading(false)
    } else {
      setLoading(true)
    }

    async function fetchDocument() {
      try {
        const res = await fetch(API.documents.byId(documentId))
        const data = await res.json()
        if (!cancelled) {
          setDoc(data.document)
          setTitle(data.document.title)
          writeCache(CACHE_KEY.documentDetail(documentId), data.document)
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
    },
    [debouncedSave]
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

  if (loading) {
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
    <div className='flex-1 flex overflow-hidden'>
      {/* TOC Sidebar */}
      <DocumentTOC
        editor={null}
        childDocs={doc.children ?? []}
        onChildClick={(child: ApiDocument) => onNavigateToDocument(child.id)}
        onAddChild={() => onCreateChildDocument(doc.id)}
      />

      {/* Editor area */}
      <div className='flex-1 overflow-y-auto'>
        <div className='max-w-3xl mx-auto px-8 py-6'>
          <DocumentBreadcrumb
            ancestors={[]}
            current={{ id: doc.id, title: doc.title, emoji: doc.emoji }}
            onNavigate={id => {
              if (id) onNavigateToDocument(id)
              else onNavigateToDocuments()
            }}
          />

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
            <span>{doc.visibility}</span>
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
    </div>
  )
}
