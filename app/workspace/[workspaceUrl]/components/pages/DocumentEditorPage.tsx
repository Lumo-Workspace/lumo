'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { DescriptionEditor } from '../DescriptionEditor'
import { DocumentTOC } from '../document/DocumentTOC'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import type { ApiDocumentDetail, ApiDocumentAncestor } from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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
  const [ancestors, setAncestors] = useState<ApiDocumentAncestor[]>(
    initialCache?.ancestors ?? []
  )
  const [loading, setLoading] = useState(!initialCache)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [title, setTitle] = useState(initialCache?.title ?? '')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Rename dialog state
  const [renameDoc, setRenameDoc] = useState<{
    id: string
    title: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Delete dialog state
  const [deleteDoc, setDeleteDoc] = useState<{
    id: string
    title: string
  } | null>(null)

  // Fetch document (background refresh when cache exists)
  useEffect(() => {
    let cancelled = false
    const cached = readCache<ApiDocumentDetail>(
      CACHE_KEY.documentDetail(documentId)
    )

    // When switching documents, seed from cache synchronously.
    // Keep previous doc/ancestors visible while loading (no full-page flash).
    if (cached) {
      setDoc(cached)
      setTitle(cached.title)
      setAncestors(cached.ancestors ?? [])
    }
    setLoading(!cached)

    async function fetchDocument() {
      try {
        const res = await fetch(API.documents.byId(documentId))
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
    <div className='flex-1 flex overflow-hidden'>
      {/* TOC Sidebar — always visible, updates seamlessly */}
      <DocumentTOC
        editor={null}
        ancestors={ancestors}
        currentDoc={{ id: doc.id, title: title || doc.title, emoji: doc.emoji }}
        childDocs={doc.children ?? []}
        onNavigate={(id: string | null) => {
          if (id) onNavigateToDocument(id)
          else onNavigateToDocuments()
        }}
        onAddChild={(parentId: string) => onCreateChildDocument(parentId)}
        onRenameDoc={(target: { id: string; title: string }) => {
          setRenameValue(target.title)
          setRenameDoc(target)
        }}
        onDeleteDoc={(target: { id: string; title: string }) => {
          setDeleteDoc(target)
        }}
        onReorderChildren={(orderedIds: string[]) => {
          fetch(API.documents.byId(doc.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childOrder: orderedIds }),
          })
        }}
      />

      {/* Editor area */}
      <div className='flex-1 overflow-y-auto'>
        {loading ? (
          <div className='flex-1 flex items-center justify-center h-full'>
            <div className='animate-pulse text-muted-foreground text-sm'>
              Loading...
            </div>
          </div>
        ) : (
          <div className='max-w-3xl mx-auto px-8 py-6'>
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
        )}
      </div>

      {/* Rename Dialog */}
      <Dialog
        open={renameDoc !== null}
        onOpenChange={open => {
          if (!open) setRenameDoc(null)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({
                id: 'documentToc.rename',
                defaultMessage: 'Rename',
              })}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={e => {
              e.preventDefault()
              if (!renameDoc || renameValue === renameDoc.title) {
                setRenameDoc(null)
                return
              }
              const renamedId = renameDoc.id
              fetch(API.documents.byId(renamedId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: renameValue }),
              }).then(res => {
                if (res.ok) {
                  // Update current doc title if renaming self
                  if (renamedId === documentId) {
                    setTitle(renameValue)
                  }
                  // Update children list if renaming a child
                  setDoc(prev =>
                    prev
                      ? {
                          ...prev,
                          children: prev.children.map(c =>
                            c.id === renamedId
                              ? { ...c, title: renameValue }
                              : c
                          ),
                        }
                      : prev
                  )
                }
              })
              setRenameDoc(null)
            }}
          >
            <Input
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              autoFocus
              placeholder={intl.formatMessage({
                id: 'documents.untitled',
                defaultMessage: 'Untitled',
              })}
            />
            <DialogFooter className='mt-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setRenameDoc(null)}
              >
                {intl.formatMessage({
                  id: 'common.cancel',
                  defaultMessage: 'Cancel',
                })}
              </Button>
              <Button type='submit'>
                {intl.formatMessage({
                  id: 'common.save',
                  defaultMessage: 'Save',
                })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog
        open={deleteDoc !== null}
        onOpenChange={open => {
          if (!open) setDeleteDoc(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id: 'documentToc.deleteConfirmTitle',
                defaultMessage: 'Delete document',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                {
                  id: 'documentToc.deleteConfirmDesc',
                  defaultMessage:
                    'Are you sure you want to delete "{title}"? This action cannot be undone.',
                },
                { title: deleteDoc?.title || 'Untitled' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={() => {
                if (!deleteDoc) return
                const deletedId = deleteDoc.id
                setDeleteDoc(null)

                // Determine if we need to navigate away
                const isCurrentDoc = deletedId === documentId
                const isAncestor = ancestors.some(a => a.id === deletedId)

                if (isCurrentDoc || isAncestor) {
                  // Navigate to parent of deleted doc, or docs list
                  const deletedAncestorIdx = isAncestor
                    ? ancestors.findIndex(a => a.id === deletedId)
                    : -1
                  const parentId =
                    deletedAncestorIdx > 0
                      ? ancestors[deletedAncestorIdx - 1]?.id
                      : null
                  if (parentId) {
                    onNavigateToDocument(parentId)
                  } else {
                    onNavigateToDocuments()
                  }
                } else {
                  // Deleting a child or sibling — optimistic remove from tree
                  setDoc(prev =>
                    prev
                      ? {
                          ...prev,
                          children: prev.children.filter(
                            c => c.id !== deletedId
                          ),
                        }
                      : prev
                  )
                }

                // Background sync
                fetch(API.documents.byId(deletedId), { method: 'DELETE' })
              }}
            >
              {intl.formatMessage({
                id: 'documentToc.delete',
                defaultMessage: 'Delete',
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
