'use client'

import { useIntl } from 'react-intl'
import { Copy, Trash2, Plus, Key, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useApiKeys } from '../../hooks/useApiKeys'

export function ApiKeysPage() {
  const intl = useIntl()
  const {
    keys,
    loading,
    label,
    setLabel,
    creating,
    newKey,
    setNewKey,
    copied,
    revokeTarget,
    setRevokeTarget,
    revoking,
    handleCreate,
    handleRevoke,
    handleCopy,
  } = useApiKeys()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'apiKeys.title' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'apiKeys.subtitle' })}
        </p>

        {/* Create form */}
        <div className='flex gap-2 mb-8'>
          <Input
            placeholder={intl.formatMessage({ id: 'apiKeys.labelPlaceholder' })}
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleCreate()}
            className='max-w-xs'
          />
          <Button
            onClick={() => void handleCreate()}
            disabled={creating || !label.trim()}
          >
            {creating ? (
              <Loader2 size={14} className='animate-spin mr-1.5' />
            ) : (
              <Plus size={14} className='mr-1.5' />
            )}
            {intl.formatMessage({ id: 'common.create' })}
          </Button>
        </div>

        {/* Key list */}
        {loading ? (
          <div className='flex items-center gap-2 text-sm text-zinc-400'>
            <Loader2 size={14} className='animate-spin' />
            {intl.formatMessage({ id: 'common.loading' })}
          </div>
        ) : keys.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-12 text-zinc-400'>
            <Key size={28} />
            <p className='text-sm'>
              {intl.formatMessage({ id: 'apiKeys.empty' })}
            </p>
          </div>
        ) : (
          <ul className='space-y-2'>
            {keys.map(k => (
              <li
                key={k.id}
                className='flex items-center justify-between px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
              >
                <div>
                  <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                    {k.label}
                  </p>
                  <p className='text-xs text-zinc-400 font-mono mt-0.5'>
                    {k.keyPrefix}…
                    {k.lastUsedAt && (
                      <span className='font-sans ml-3'>
                        {intl.formatMessage(
                          { id: 'apiKeys.lastUsed' },
                          { date: new Date(k.lastUsedAt).toLocaleDateString() }
                        )}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-zinc-400 hover:text-destructive'
                  onClick={() => setRevokeTarget(k)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* New key modal — show full key once */}
        <AlertDialog
          open={!!newKey}
          onOpenChange={open => !open && setNewKey(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {intl.formatMessage({ id: 'apiKeys.newKeyTitle' })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {intl.formatMessage({ id: 'apiKeys.newKeyDesc' })}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className='flex items-center gap-2 my-2'>
              <code className='flex-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 break-all font-mono'>
                {newKey?.key}
              </code>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void handleCopy()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>

            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setNewKey(null)}>
                {intl.formatMessage({ id: 'common.close' })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revoke confirmation */}
        <AlertDialog
          open={!!revokeTarget}
          onOpenChange={open => !open && setRevokeTarget(null)}
        >
          <AlertDialogContent size='sm'>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {intl.formatMessage({ id: 'apiKeys.revokeTitle' })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {intl.formatMessage({ id: 'apiKeys.revokeDesc' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {intl.formatMessage({ id: 'common.cancel' })}
              </AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                onClick={() => void handleRevoke()}
                disabled={revoking}
              >
                {revoking ? (
                  <Loader2 size={14} className='animate-spin' />
                ) : (
                  intl.formatMessage({ id: 'common.revoke' })
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
