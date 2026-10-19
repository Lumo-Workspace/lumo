'use client'

import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApiKeys } from '../../hooks/useApiKeys'
import { NewApiKeyDialog } from '../api-keys/NewApiKeyDialog'
import { Spinner } from '@/components/ui/spinner'

export function CliCreateKeyForm() {
  const intl = useIntl()
  const {
    label,
    setLabel,
    creating,
    newKey,
    setNewKey,
    copied,
    handleCreate,
    handleCopy,
  } = useApiKeys()

  return (
    <>
      <div className='flex gap-2'>
        <Input
          placeholder={intl.formatMessage({
            id: 'cli.step.login.labelPlaceholder',
          })}
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
          {intl.formatMessage({ id: 'cli.step.login.createSubmit' })}
        </Button>
      </div>

      <NewApiKeyDialog
        open={!!newKey}
        keyValue={newKey?.key ?? null}
        copied={copied}
        onCopy={() => void handleCopy()}
        onClose={() => setNewKey(null)}
      />
    </>
  )
}
