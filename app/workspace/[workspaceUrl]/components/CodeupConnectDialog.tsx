'use client'

import { useState, useId } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { codeupApi } from '@/lib/api-client/codeup'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

/** LUM-1315 — organization id + personal access token for Codeup. */
export function CodeupConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const fieldId = useId()
  const [organizationId, setOrganizationId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    try {
      await codeupApi.connect(workspaceUrl, { organizationId, accessToken })
      toast.success(intl.formatMessage({ id: 'codeup.connectSuccess' }))
      setOrganizationId('')
      setAccessToken('')
      onConnected()
      onOpenChange(false)
    } catch {
      // The server's message names no secret, but keep the copy localized.
      toast.error(intl.formatMessage({ id: 'codeup.connectFailed' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'codeup.connectTitle' })}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3 text-body'>
          <div>
            <Label
              htmlFor={`${fieldId}-org`}
              className='text-caption text-foreground'
            >
              {intl.formatMessage({ id: 'codeup.organizationIdLabel' })}
            </Label>
            <input
              id={`${fieldId}-org`}
              className='mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-body font-mono'
              value={organizationId}
              onChange={e => setOrganizationId(e.target.value)}
              autoComplete='off'
            />
          </div>
          <div>
            <Label
              htmlFor={`${fieldId}-token`}
              className='text-caption text-foreground'
            >
              {intl.formatMessage({ id: 'codeup.accessTokenLabel' })}
            </Label>
            <input
              id={`${fieldId}-token`}
              type='password'
              className='mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-body'
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              autoComplete='off'
            />
            <p className='mt-1 text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'codeup.accessTokenHint' })}
            </p>
            <p
              className='mt-1 text-caption text-muted-foreground'
              data-testid='codeup-comment-author-hint'
            >
              {intl.formatMessage({ id: 'codeup.commentAuthorHint' })}
            </p>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              size='sm'
              onClick={submit}
              disabled={submitting || !organizationId || !accessToken}
            >
              {intl.formatMessage({ id: 'common.connect' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
