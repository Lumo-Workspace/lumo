'use client'

import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import { Trash2, Plus, Key, Loader2 } from 'lucide-react'
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
import { NewApiKeyDialog } from '../api-keys/NewApiKeyDialog'

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
    creatingIngest,
    handleCreate,
    handleCreateIngestKey,
    handleRevoke,
    handleCopy,
  } = useApiKeys()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'apiKeys.title' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-8'>
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

        <div className='mb-8 rounded-md border border-border p-4'>
          <p className='text-sm font-medium text-foreground'>
            {intl.formatMessage({ id: 'apiKeys.ingest.title' })}
          </p>
          <p className='mt-1 text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'apiKeys.ingest.description' })}
          </p>
          <Button
            variant='outline'
            className='mt-3'
            onClick={() => void handleCreateIngestKey()}
            disabled={creatingIngest}
          >
            {creatingIngest ? (
              <Loader2 size={14} className='animate-spin mr-1.5' />
            ) : (
              <Plus size={14} className='mr-1.5' />
            )}
            {intl.formatMessage({ id: 'apiKeys.ingest.create' })}
          </Button>
        </div>

        {/* Key list */}
        {loading ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Loader2 size={14} className='animate-spin' />
            {intl.formatMessage({ id: 'common.loading' })}
          </div>
        ) : keys.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-12 text-muted-foreground'>
            <Key size={28} />
            <p className='text-sm'>
              {intl.formatMessage({ id: 'apiKeys.empty' })}
            </p>
          </div>
        ) : (
          <ul className='space-y-2'>
            {keys.map(k => (
              <Card
                key={k.id}
                asChild
                className='flex items-center justify-between px-4 py-3'
              >
                <li>
                  <div>
                    <p className='text-sm font-medium text-foreground'>
                      {k.label}
                      {k.scope === 'security:ingest' && (
                        <span className='ml-2 rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground'>
                          {intl.formatMessage({
                            id: 'apiKeys.scope.securityIngest',
                          })}
                        </span>
                      )}
                    </p>
                    <p className='text-xs text-muted-foreground font-mono mt-0.5'>
                      {k.keyPrefix}…
                      {k.lastUsedAt && (
                        <span className='font-sans ml-3'>
                          {intl.formatMessage(
                            { id: 'apiKeys.lastUsed' },
                            {
                              date: new Date(k.lastUsedAt).toLocaleDateString(),
                            }
                          )}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground hover:text-destructive'
                    onClick={() => setRevokeTarget(k)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              </Card>
            ))}
          </ul>
        )}

        <NewApiKeyDialog
          open={!!newKey}
          keyValue={newKey?.key ?? null}
          copied={copied}
          onCopy={() => void handleCopy()}
          onClose={() => setNewKey(null)}
        />

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
