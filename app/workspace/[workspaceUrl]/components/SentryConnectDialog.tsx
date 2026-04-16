'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
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
      toast.success(
        'Sentry connected. Send a test webhook from Sentry to verify.'
      )
      onConnected()
      onOpenChange(false)
      setOrgSlug('')
      setClientSecret('')
    } catch (err) {
      const msg = (err as Error).message || 'Failed to connect Sentry'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Connect Sentry</DialogTitle>
        </DialogHeader>

        <div className='space-y-4 text-sm'>
          <div>
            <p className='font-medium'>
              1. Create a Sentry Internal Integration
            </p>
            <p className='mt-1 text-xs text-zinc-500'>
              In Sentry, go to{' '}
              <code className='font-mono'>
                Organization Settings → Developer Settings → New Internal
                Integration
              </code>
              . Paste this webhook URL and enable &quot;Issue Alert&quot; under
              Alerts:
            </p>
            <div className='mt-2 flex items-center gap-2'>
              <code className='flex-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-1 font-mono text-xs break-all'>
                {webhookUrl}
              </code>
              <button
                className='text-xs px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700'
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
              >
                Copy
              </button>
            </div>
          </div>

          <div>
            <p className='font-medium'>2. Paste your Sentry details</p>
            <div className='mt-2 space-y-2'>
              <label className='block'>
                <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                  Organization Slug
                </span>
                <input
                  className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm'
                  value={orgSlug}
                  onChange={e => setOrgSlug(e.target.value)}
                  placeholder='acme-inc'
                />
              </label>
              <label className='block'>
                <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                  Client Secret
                </span>
                <input
                  type='password'
                  className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm'
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <button
              className='text-xs px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700'
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className='text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50'
              onClick={submit}
              disabled={submitting || !orgSlug || !clientSecret}
            >
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
