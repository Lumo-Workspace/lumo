'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiClientError } from '@/lib/api-client'
import { feishuDocsApi } from '@/lib/api-client/feishu-docs'
import { feishuDocErrorMessageId } from './feishu-doc-errors'

interface FeishuImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new doc's slug once the import succeeded. */
  onImported: (slug: string) => void
}

/** LUM-1343 — paste a Feishu / Lark docx or wiki link to import it. */
export function FeishuImportDialog({
  open,
  onOpenChange,
  onImported,
}: FeishuImportDialogProps) {
  const intl = useIntl()
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorId, setErrorId] = useState<string | null>(null)

  const close = (next: boolean) => {
    if (submitting) return
    if (!next) {
      setUrl('')
      setErrorId(null)
    }
    onOpenChange(next)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    setErrorId(null)
    try {
      const result = await feishuDocsApi.importDoc(url.trim())
      const partial = result.unsupported.length > 0 || result.missingImages > 0
      toast.success(
        intl.formatMessage({
          id: partial ? 'feishuDocs.importedPartial' : 'feishuDocs.imported',
        })
      )
      setUrl('')
      onOpenChange(false)
      onImported(result.document.slug)
    } catch (error) {
      setErrorId(
        feishuDocErrorMessageId(
          error instanceof ApiClientError ? error.code : null
        )
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'feishuDocs.importTitle' })}
            </DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: 'feishuDocs.importDescription' })}
            </DialogDescription>
          </DialogHeader>
          <div className='mt-4 space-y-2'>
            <Label htmlFor='feishu-doc-url'>
              {intl.formatMessage({ id: 'feishuDocs.urlLabel' })}
            </Label>
            <Input
              id='feishu-doc-url'
              type='url'
              value={url}
              autoComplete='off'
              placeholder='https://example.feishu.cn/docx/…'
              onChange={e => setUrl(e.target.value)}
              disabled={submitting}
            />
            {errorId && (
              <p role='alert' className='text-caption text-danger-text'>
                {intl.formatMessage({ id: errorId })}
              </p>
            )}
          </div>
          <DialogFooter className='mt-4'>
            <Button
              type='button'
              variant='ghost'
              onClick={() => close(false)}
              disabled={submitting}
            >
              {intl.formatMessage({ id: 'feishuDocs.cancel' })}
            </Button>
            <Button type='submit' disabled={submitting || !url.trim()}>
              {intl.formatMessage({
                id: submitting
                  ? 'feishuDocs.importing'
                  : 'feishuDocs.importButton',
              })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
