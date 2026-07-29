'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Brain, Plus } from 'lucide-react'
import type { MemoryRow } from '@/lib/api-client'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { useMemories, type MemoryScopeKind } from '../../hooks/useMemories'
import { useFragmentTrust } from '../../hooks/useFragmentTrust'
import { useRetireCandidates } from '../../hooks/useRetireCandidates'
import { useMergeCandidates } from '../../hooks/useMergeCandidates'
import { Button } from '@/components/ui/button'
import { MemoryListItem } from './MemoryListItem'
import { RetireReviewPanel } from './RetireReviewPanel'
import { MergeReviewPanel } from './MergeReviewPanel'
import { MemoryEditDialog, type MemorySubmitPayload } from './MemoryEditDialog'

interface MemoryTabProps {
  scope: MemoryScopeKind
  parentId: string
  enabled: boolean
  /** memberId → display name, for "Added by X". Optional. */
  memberNames?: Map<string, string>
}

type DialogState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; editing: MemoryRow }

export function MemoryTab({
  scope,
  parentId,
  enabled,
  memberNames,
}: MemoryTabProps) {
  const intl = useIntl()
  const { memories, loading, error, create, edit, promote, remove, mutating } =
    useMemories({
      scope,
      parentId,
      enabled,
    })
  const [dialog, setDialog] = useState<DialogState>({ open: false })

  // Drop rows whose content can't be parsed (e.g. stored before a schema
  // change). MemoryCard renders null for those, which would otherwise leave an
  // orphaned action menu + source label floating over an empty card. Filtering
  // here keeps the count and the list consistent. Near-impossible in practice
  // since content is validated on every write, but a cheap robustness guard.
  const visibleMemories = useMemo(
    () =>
      memories.filter(m => {
        try {
          parseMemoryContent(m.category, m.content)
          return true
        } catch {
          return false
        }
      }),
    [memories]
  )

  const trust = useFragmentTrust(
    visibleMemories.map(m => m.id),
    enabled
  )

  // Retire review (LUM-540 P4a) is a PROJECT-scope concern — the judged-used
  // track record accrues across tasks against the canonical PROJECT memory.
  const isProject = scope === 'project'
  const { candidates, confirmRetire, confirming } = useRetireCandidates(
    parentId,
    enabled && isProject
  )
  const {
    candidates: mergeCandidates,
    confirmMerge,
    confirming: merging,
  } = useMergeCandidates(parentId, enabled && isProject)
  const memoriesById = useMemo(
    () => new Map(visibleMemories.map(m => [m.id, m])),
    [visibleMemories]
  )

  const handleSubmit = async (payload: MemorySubmitPayload) => {
    try {
      if (dialog.open && dialog.mode === 'edit') {
        await edit(dialog.editing.id, payload.content)
      } else {
        await create(payload)
      }
      setDialog({ open: false })
    } catch (e) {
      // Keep the dialog open so the user can retry; the mutation failed.
      console.error('Memory mutation failed:', e)
      toast.error(
        intl.formatMessage({
          id: 'memory.mutation.error',
          defaultMessage: 'Failed to save memory. Please try again.',
        })
      )
    }
  }

  if (loading) {
    return (
      <div className='py-8 text-center text-xs text-muted-foreground'>
        {intl.formatMessage({
          id: 'agentRun.loading',
          defaultMessage: '加载中…',
        })}
      </div>
    )
  }

  if (error) {
    return <div className='py-8 text-center text-xs text-red-500'>{error}</div>
  }

  return (
    <div className='space-y-3'>
      {/* Header (count + add) is chrome for a populated list. When empty, the
          empty state below owns the messaging and CTA — rendering the header
          too would duplicate both the "no memories" label and the add action. */}
      {visibleMemories.length > 0 && (
        <div className='flex items-center justify-between'>
          <span className='text-xs text-muted-foreground'>
            {intl.formatMessage(
              { id: 'memory.tab.count', defaultMessage: '{count} memories' },
              { count: visibleMemories.length }
            )}
          </span>
          {/* Same shape as the milestones tab's "New milestone" — default
              primary Button with a leading Plus — so sibling tabs read as one
              system. */}
          <Button onClick={() => setDialog({ open: true, mode: 'create' })}>
            <Plus className='size-4' aria-hidden />
            {intl.formatMessage({ id: 'memory.action.add' })}
          </Button>
        </div>
      )}

      {visibleMemories.length === 0 ? (
        <div className='py-12 flex flex-col items-center gap-2 text-muted-foreground'>
          <Brain className='size-6' />
          <p className='text-sm font-medium'>
            {intl.formatMessage({ id: 'memory.tab.empty.title' })}
          </p>
          <p className='text-[11px] max-w-xs text-center'>
            {intl.formatMessage({ id: 'memory.tab.empty.description' })}
          </p>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setDialog({ open: true, mode: 'create' })}
          >
            {intl.formatMessage({ id: 'memory.tab.empty.cta' })}
          </Button>
        </div>
      ) : (
        <div className='space-y-2'>
          {isProject && (
            <MergeReviewPanel
              candidates={mergeCandidates}
              memoriesById={memoriesById}
              onConfirm={confirmMerge}
              confirming={merging}
            />
          )}
          {isProject && (
            <RetireReviewPanel
              candidates={candidates}
              memoriesById={memoriesById}
              onConfirm={confirmRetire}
              confirming={confirming}
            />
          )}
          {visibleMemories.map(m => (
            <MemoryListItem
              key={m.id}
              memory={m}
              canPromote={scope === 'task' && m.scope === 'TASK'}
              memberName={
                m.createdByMemberId
                  ? memberNames?.get(m.createdByMemberId)
                  : undefined
              }
              trust={trust[m.id]}
              onEdit={editing =>
                setDialog({ open: true, mode: 'edit', editing })
              }
              onPromote={mem => promote(mem.id)}
              onDelete={mem => remove(mem.id)}
            />
          ))}
        </div>
      )}

      {dialog.open && (
        <MemoryEditDialog
          key={dialog.mode === 'edit' ? dialog.editing.id : 'create'}
          open
          mode={dialog.mode}
          {...(dialog.mode === 'edit' ? { editing: dialog.editing } : {})}
          onOpenChange={open => {
            if (!open) setDialog({ open: false })
          }}
          onSubmit={handleSubmit}
          submitting={mutating}
        />
      )}
    </div>
  )
}
