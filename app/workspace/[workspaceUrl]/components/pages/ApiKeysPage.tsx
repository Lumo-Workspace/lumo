'use client'

import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import { Trash2, Plus, Key } from 'lucide-react'
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
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { AsyncContent } from '../AsyncContent'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'

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
        <h1 className='text-heading text-foreground mb-1'>
          {intl.formatMessage({ id: 'apiKeys.title' })}
        </h1>
        <p className='text-body text-muted-foreground mb-8'>
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
              <Spinner className='size-3.5 mr-1.5' />
            ) : (
              <Plus size={14} className='mr-1.5' />
            )}
            {intl.formatMessage({ id: 'common.create' })}
          </Button>
        </div>

        <div className='mb-8 rounded-md border border-border p-4'>
          <p className='text-body-strong text-foreground'>
            {intl.formatMessage({ id: 'apiKeys.ingest.title' })}
          </p>
          <p className='mt-1 text-body text-muted-foreground'>
            {intl.formatMessage({ id: 'apiKeys.ingest.description' })}
          </p>
          <Button
            variant='outline'
            className='mt-3'
            onClick={() => void handleCreateIngestKey()}
            disabled={creatingIngest}
          >
            {creatingIngest ? (
              <Spinner className='size-3.5 mr-1.5' />
            ) : (
              <Plus size={14} className='mr-1.5' />
            )}
            {intl.formatMessage({ id: 'apiKeys.ingest.create' })}
          </Button>
        </div>

        {/* Key list */}
        <AsyncContent
          loading={loading}
          empty={keys.length === 0}
          loadingState={
            <RowListSkeleton
              rows={3}
              subtitle
              trailing={false}
              rowClassName='rounded-xl border border-border px-4 py-3'
              className='space-y-2'
            />
          }
          emptyState={
            <div className='flex flex-col items-center gap-2 py-12 text-muted-foreground'>
              <Key size={28} />
              <p className='text-body'>
                {intl.formatMessage({ id: 'apiKeys.empty' })}
              </p>
            </div>
          }
        >
          <ul className='space-y-2'>
            {keys.map(k => (
              <Card
                key={k.id}
                asChild
                className='flex items-center justify-between px-4 py-3'
              >
                <li>
                  <div>
                    <p className='text-body-strong text-foreground'>
                      {k.label}
                      {k.scope === 'security:ingest' && (
                        <Badge
                          variant='outline-muted'
                          size='xs'
                          shape='square'
                          className='ml-2 uppercase'
                        >
                          {intl.formatMessage({
                            id: 'apiKeys.scope.securityIngest',
                          })}
                        </Badge>
                      )}
                    </p>
                    <p className='text-caption text-muted-foreground font-mono mt-0.5'>
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
        </AsyncContent>

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
                  <Spinner className='size-3.5' />
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
