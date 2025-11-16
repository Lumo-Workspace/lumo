'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import RichTextEditor from '@/components/core/editor/rich-text/RichTextEditor'
import { useDocumentSave } from '@/hooks/use-document-save'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface DocumentEditorProps {
  documentId: string | null
  workspaceId: string
}

/**
 * DocumentEditor - Container component that integrates RichTextEditor with document save/load
 * Handles document loading, editing, auto-save, and manual save
 */
export function DocumentEditor({
  documentId,
  workspaceId: _workspaceId,
}: DocumentEditorProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorContent, setEditorContent] = useState<any>(null)
  const [documentTitle, setDocumentTitle] = useState<string>('')
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false)
  // Avoid marking as "Unsaved" on initial content hydration
  const ignoreNextUpdateRef = useRef<boolean>(true)
  const [initialSavedAt, setInitialSavedAt] = useState<Date | null>(null)

  // Load document
  useEffect(() => {
    const loadDocument = async () => {
      if (!documentId) {
        setEditorContent(null)
        setDocumentTitle('')
        return
      }

      try {
        setLoading(true)
        setError(null)
        const response = await fetch(`/api/documents/${documentId}`)

        if (!response.ok) {
          throw new Error('Failed to load document')
        }

        const data = await response.json()
        setDocumentTitle(data.title)
        // Use TipTap JSON directly
        setEditorContent(data.content)
        // Capture initial saved time from server
        if (data.updatedAt) {
          setInitialSavedAt(new Date(data.updatedAt))
        }
        // The next editor update is from setContent; ignore it
        ignoreNextUpdateRef.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document')
        console.error('Failed to load document:', err)
      } finally {
        setLoading(false)
      }
    }

    loadDocument()
  }, [documentId])

  // Save handler
  const handleSave = useCallback(
    async (content: any, title?: string) => {
      if (!documentId) return

      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          ...(title && { title }),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save document')
      }
    },
    [documentId]
  )

  const {
    saveState,
    error: saveError,
    debouncedSave,
    lastSaved,
  } = useDocumentSave({
    documentId,
    onSave: handleSave,
  })

  // Handle editor content updates (TipTap JSON)
  const handleEditorUpdateJSON = useCallback(
    (content: any) => {
      // Skip the first editor update triggered by setContent on load
      if (ignoreNextUpdateRef.current) {
        ignoreNextUpdateRef.current = false
        setEditorContent(content)
        return
      }
      setEditorContent(content)
      setHasPendingChanges(true)
      // Extract H1 title from TipTap JSON
      let extractedTitle = 'Untitled'
      if (content && Array.isArray(content.content)) {
        const first = content.content.find(
          (n: any) => n.type === 'heading' && (n.attrs?.level ?? 1) === 1
        )
        if (first && Array.isArray(first.content)) {
          const textNode = first.content.find((c: any) => c.type === 'text')
          if (textNode?.text && typeof textNode.text === 'string') {
            const trimmed = textNode.text.trim()
            if (trimmed.length > 0) {
              extractedTitle = trimmed
            }
          }
        }
      }
      setDocumentTitle(extractedTitle)
      debouncedSave(content, extractedTitle)
    },
    [debouncedSave]
  )

  // Broadcast title changes to sidebar after successful save
  useEffect(() => {
    if (saveState === 'saved') {
      setHasPendingChanges(false)
    }
    if (saveState === 'saved' && documentId) {
      window.dispatchEvent(
        new CustomEvent('document:title-updated', {
          detail: { documentId, title: documentTitle },
        })
      )
    }
  }, [saveState, documentId, documentTitle])

  if (loading) {
    return (
      <div className='flex items-center justify-center h-screen'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-screen'>
        <div className='text-center'>
          <AlertCircle className='h-8 w-8 text-destructive mx-auto mb-2' />
          <p className='text-destructive'>{error}</p>
        </div>
      </div>
    )
  }

  if (!documentId) {
    return (
      <div className='flex items-center justify-center h-screen'>
        <div className='text-center text-muted-foreground'>
          <p>Select a document to start editing</p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col h-screen'>
      {/* Save status bar */}
      <div className='flex items-center justify-between px-4 py-2 border-b bg-background'>
        <div className='flex items-center gap-2'>
          {loading && (
            <>
              <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
              <span className='text-sm text-muted-foreground'>Loading...</span>
            </>
          )}
          {!loading && saveState === 'saving' && (
            <>
              <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
              <span className='text-sm text-muted-foreground'>Saving...</span>
            </>
          )}
          {!loading && saveState === 'saved' && (
            <>
              <CheckCircle2 className='h-4 w-4 text-green-600' />
              <span className='text-sm text-green-600'>
                Saved
                {lastSaved
                  ? ` • ${formatDistanceToNow(new Date(lastSaved), { addSuffix: true })}`
                  : ''}
              </span>
            </>
          )}
          {!loading && saveState === 'error' && (
            <>
              <AlertCircle className='h-4 w-4 text-destructive' />
              <span className='text-sm text-destructive'>
                {saveError || 'Failed to save'}
              </span>
            </>
          )}
          {!loading && saveState === 'idle' && hasPendingChanges && (
            <span className='text-sm text-muted-foreground'>
              Unsaved changes
            </span>
          )}
          {!loading &&
            saveState === 'idle' &&
            !hasPendingChanges &&
            (lastSaved || initialSavedAt) && (
              <span className='text-sm text-muted-foreground'>
                Last saved •{' '}
                {formatDistanceToNow(
                  new Date(lastSaved ?? (initialSavedAt as Date)),
                  { addSuffix: true }
                )}
              </span>
            )}
        </div>
      </div>

      {/* Editor */}
      <div className='flex-1 overflow-hidden'>
        <RichTextEditor
          content={editorContent}
          onUpdateJSON={handleEditorUpdateJSON}
          editable={true}
          documentId={documentId}
        />
      </div>
    </div>
  )
}
