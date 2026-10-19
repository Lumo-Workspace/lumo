'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import type { MemoryRow } from '@/lib/api-client'
import { parseMemoryContent } from '@/lib/memory/schemas'
import {
  countByCategory,
  selectMemories,
  type MemoryCategoryFilter,
  type MemorySortKey,
} from '@/lib/memory/list-view'
import { useMemories, type MemoryScopeKind } from '../../hooks/useMemories'
import { useFragmentTrust } from '../../hooks/useFragmentTrust'
import { useRetireCandidates } from '../../hooks/useRetireCandidates'
import { useMergeCandidates } from '../../hooks/useMergeCandidates'
import { Button } from '@/components/ui/button'
import { MemoryListItem } from './MemoryListItem'
import { MemoryListToolbar } from './MemoryListToolbar'
import { MemoryListSkeleton } from './MemoryListSkeleton'
import { MemoryListEmpty } from './MemoryListEmpty'
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
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<MemoryCategoryFilter>('ALL')
  const [sort, setSort] = useState<MemorySortKey>('recent')

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

  // Search / sort / filter is project-scope chrome. A task's dossier holds a
  // handful of memories at most, where a full control row costs more attention
  // than scanning the list it sits above.
  const showControls = isProject
  const filtering = query.trim().length > 0 || category !== 'ALL'

  const counts = useMemo(
    () => countByCategory(visibleMemories),
    [visibleMemories]
  )

  const shownMemories = useMemo(
    () =>
      showControls
        ? selectMemories(visibleMemories, {
            query,
            category,
            sort,
            usage: trust,
          })
        : visibleMemories,
    [showControls, visibleMemories, query, category, sort, trust]
  )

  const clearFilters = () => {
    setQuery('')
    setCategory('ALL')
  }

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

  if (error) {
    return (
      <div className='py-8 text-center text-xs text-danger-text'>{error}</div>
    )
  }

  // While loading, the chrome stays and only the list body is a placeholder —
  // the same shape as the milestones tab. Mounting the header and controls
  // after the rows land would push the whole list down as it appears.
  const hasChrome = loading || visibleMemories.length > 0

  return (
    <div className='space-y-3'>
      {/* Header (count + add) is chrome for a populated list. When empty, the
          empty state below owns the messaging and CTA — rendering the header
          too would duplicate both the "no memories" label and the add action. */}
      {hasChrome && (
        <div className='flex items-center justify-between'>
          {/* Counts what is on screen, so it tracks the filter. At zero it goes
              silent rather than reading "No memories" over a project that has
              some — the empty state below says why the list is empty. */}
          <span className='text-xs text-muted-foreground'>
            {shownMemories.length > 0
              ? intl.formatMessage(
                  {
                    id: 'memory.tab.count',
                    defaultMessage: '{count} memories',
                  },
                  { count: shownMemories.length }
                )
              : null}
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

      {showControls && hasChrome && (
        <MemoryListToolbar
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          category={category}
          onCategoryChange={setCategory}
          counts={counts}
          total={visibleMemories.length}
          pending={loading}
        />
      )}

      {loading ? (
        <MemoryListSkeleton />
      ) : shownMemories.length === 0 ? (
        <MemoryListEmpty
          variant={filtering ? 'noResults' : 'none'}
          onCreate={() => setDialog({ open: true, mode: 'create' })}
          onClearFilters={clearFilters}
        />
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
          {shownMemories.map(m => (
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
