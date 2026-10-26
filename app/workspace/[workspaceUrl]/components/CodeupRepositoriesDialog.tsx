'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { codeupApi } from '@/lib/api-client/codeup'
import { queryKeys } from '@/lib/query/keys'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

/** LUM-1315 — pick which Codeup repositories Lumo links to tasks. */
export function CodeupRepositoriesDialog({
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  // null = untouched: the selection is what the server says is confirmed.
  const [picked, setPicked] = useState<Set<number> | null>(null)
  const [saving, setSaving] = useState(false)

  const query = useQuery({
    queryKey: queryKeys.integrations.codeupRepositories(workspaceUrl),
    queryFn: () => codeupApi.listRepositories(workspaceUrl),
    enabled: open,
    retry: false,
  })
  const repositories = query.data?.repositories ?? []
  const selected =
    picked ??
    new Set(repositories.filter(r => r.confirmed).map(r => r.repositoryId))

  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  const close = (next: boolean) => {
    if (!next) setPicked(null)
    onOpenChange(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      await codeupApi.updateRepositories(workspaceUrl, [...selected])
      toast.success(intl.formatMessage({ id: 'codeup.repositoriesSaved' }))
      onSaved()
      close(false)
    } catch {
      toast.error(intl.formatMessage({ id: 'codeup.repositoriesSaveFailed' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'codeup.repositoriesTitle' })}
          </DialogTitle>
        </DialogHeader>
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'codeup.repositoriesHint' })}
        </p>
        {query.isLoading ? (
          <div className='flex justify-center py-6'>
            <Spinner className='text-muted-foreground' />
          </div>
        ) : query.isError ? (
          <p className='text-caption text-danger-text'>
            {intl.formatMessage({ id: 'codeup.repositoriesLoadFailed' })}
          </p>
        ) : repositories.length === 0 ? (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'codeup.noRepositories' })}
          </p>
        ) : (
          <ul className='max-h-80 overflow-y-auto space-y-2'>
            {repositories.map(repo => (
              <li key={repo.repositoryId}>
                <label className='flex items-center gap-2 text-body'>
                  <Checkbox
                    checked={selected.has(repo.repositoryId)}
                    onCheckedChange={v => toggle(repo.repositoryId, v === true)}
                  />
                  <span className='font-mono text-caption break-all'>
                    {repo.pathWithNamespace}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className='flex justify-end gap-2 pt-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => close(false)}
            disabled={saving}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button
            size='sm'
            onClick={save}
            disabled={saving || query.isLoading || query.isError}
          >
            {intl.formatMessage({ id: 'common.save' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
