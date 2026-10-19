'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sentryApi } from '@/lib/api-client/sentry'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function SentryConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const [orgSlug, setOrgSlug] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/sentry`
      : ''

  const submit = async () => {
    setSubmitting(true)
    try {
      await sentryApi.connect(workspaceUrl, { orgSlug, clientSecret })
      toast.success(intl.formatMessage({ id: 'sentry.connectSuccess' }))
      onConnected()
      onOpenChange(false)
      setOrgSlug('')
      setClientSecret('')
    } catch (err) {
      const msg =
        (err as Error).message ||
        intl.formatMessage({ id: 'sentry.connectFailed' })
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'sentry.connectTitle' })}
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-4 text-body'>
          <div>
            <p className='text-body-strong'>
              {intl.formatMessage({ id: 'sentry.connectStep1Title' })}
            </p>
            <p className='mt-1 text-caption text-muted-foreground'>
              <FormattedMessage
                id='sentry.connectStep1Desc'
                values={{
                  code: chunks => <code className='font-mono'>{chunks}</code>,
                }}
              />
            </p>
            <div className='mt-2 flex items-center gap-2'>
              <code className='flex-1 rounded-md bg-muted px-2 py-1 font-mono text-caption break-all'>
                {webhookUrl}
              </code>
              <button
                className='text-caption px-2 py-1 rounded-md border border-border'
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
              >
                {intl.formatMessage({ id: 'common.copy' })}
              </button>
            </div>
          </div>

          <div>
            <p className='text-body-strong'>
              {intl.formatMessage({ id: 'sentry.connectStep2Title' })}
            </p>
            <div className='mt-2 space-y-2'>
              <label className='block'>
                <span className='text-caption text-foreground'>
                  {intl.formatMessage({ id: 'sentry.connectOrgSlugLabel' })}
                </span>
                <input
                  className='mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-body'
                  value={orgSlug}
                  onChange={e => setOrgSlug(e.target.value)}
                  placeholder='acme-inc'
                />
              </label>
              <label className='block'>
                <span className='text-caption text-foreground'>
                  {intl.formatMessage({
                    id: 'sentry.connectClientSecretLabel',
                  })}
                </span>
                <input
                  type='password'
                  className='mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-body'
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <button
              className='text-caption px-3 py-1.5 rounded-md border border-border'
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </button>
            <button
              className='text-caption px-3 py-1.5 rounded-md bg-foreground text-background disabled:opacity-50'
              onClick={submit}
              disabled={submitting || !orgSlug || !clientSecret}
            >
              {submitting
                ? intl.formatMessage({ id: 'sentry.connecting' })
                : intl.formatMessage({ id: 'sentry.connectSentry' })}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
