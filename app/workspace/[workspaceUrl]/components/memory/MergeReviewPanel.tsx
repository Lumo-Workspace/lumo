'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { GitMerge } from 'lucide-react'
import type { MemoryRow, MergeProposal } from '@/lib/api-client'
import { memoryContentToText } from '@/lib/memory/content-text'
import { Button } from '@/components/ui/button'

interface MergeReviewPanelProps {
  candidates: MergeProposal[]
  /** id → memory row, for the one-line snippets. Proposals whose canonical or
   *  any superseded row is missing here are skipped. */
  memoriesById: Map<string, MemoryRow>
  onConfirm: (canonicalId: string, supersededIds: string[]) => Promise<unknown>
  confirming: boolean
}

function snippet(memory: MemoryRow): string {
  return memoryContentToText(memory.category, memory.content)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/**
 * LUM-541 (P5) — the human review surface for proposed near-dup MERGES from the
 * batch consolidation sweep. Each proposal shows the row that will be KEPT
 * (canonical, the most judged-used in its cluster) and the near-dup siblings that
 * will be merged away. A human chooses Merge (→ siblings archived via the
 * existing status machine, reversible — 失效非删) or Keep (dismissed locally this
 * session; candidacy is derived, so it may resurface). The agent/CLI has no
 * confirm path — the server refuses a non-human caller 403.
 */
export function MergeReviewPanel({
  candidates,
  memoriesById,
  onConfirm,
  confirming,
}: MergeReviewPanelProps) {
  const intl = useIntl()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = candidates.filter(
    c =>
      !dismissed.has(c.canonicalId) &&
      memoriesById.has(c.canonicalId) &&
      c.supersededIds.some(id => memoriesById.has(id))
  )
  if (visible.length === 0) return null

  const handleConfirm = async (c: MergeProposal) => {
    // Only archive siblings we can actually see (and that still exist).
    const supersededIds = c.supersededIds.filter(id => memoriesById.has(id))
    try {
      await onConfirm(c.canonicalId, supersededIds)
      toast.success(
        intl.formatMessage({
          id: 'memory.merge.confirmed',
          defaultMessage: 'Memories merged',
        })
      )
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'memory.merge.error',
          defaultMessage: 'Could not merge the memories. Please try again.',
        })
      )
    }
  }

  const dismiss = (canonicalId: string) =>
    setDismissed(prev => new Set(prev).add(canonicalId))

  return (
    <div className='rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-2'>
      <div className='flex items-center gap-1.5 text-caption text-muted-foreground'>
        <GitMerge className='size-3.5' />
        {intl.formatMessage(
          {
            id: 'memory.merge.heading',
            defaultMessage:
              '{count, plural, one {# near-duplicate cluster to merge} other {# near-duplicate clusters to merge}}',
          },
          { count: visible.length }
        )}
      </div>
      <p className='text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'memory.merge.description',
          defaultMessage:
            'Merging keeps the most-used entry and archives its near-duplicates. Archiving is reversible. Keep leaves them all active.',
        })}
      </p>
      <ul className='space-y-2'>
        {visible.map(c => {
          const canonical = memoriesById.get(c.canonicalId)!
          const siblings = c.supersededIds
            .map(id => memoriesById.get(id))
            .filter((m): m is MemoryRow => m !== undefined)
          return (
            <li
              key={c.canonicalId}
              className='space-y-1 rounded-sm bg-background/60 px-2 py-1.5'
            >
              <div className='flex items-center justify-between gap-2'>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-1'>
                    <span className='rounded-sm border border-border px-1 text-caption text-muted-foreground'>
                      {intl.formatMessage({
                        id: 'memory.merge.keepBadge',
                        defaultMessage: 'keep',
                      })}
                    </span>
                    <p className='truncate text-caption text-foreground'>
                      {snippet(canonical)}
                    </p>
                  </div>
                </div>
                <div className='flex shrink-0 gap-1'>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-6 px-2 text-caption'
                    onClick={() => dismiss(c.canonicalId)}
                  >
                    {intl.formatMessage({
                      id: 'memory.merge.dismiss',
                      defaultMessage: 'Keep',
                    })}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-6 px-2 text-caption'
                    disabled={confirming}
                    onClick={() => handleConfirm(c)}
                  >
                    {intl.formatMessage({
                      id: 'memory.merge.confirm',
                      defaultMessage: 'Merge',
                    })}
                  </Button>
                </div>
              </div>
              <ul className='space-y-0.5 pl-2'>
                {siblings.map(s => (
                  <li
                    key={s.id}
                    className='flex items-center gap-1 text-caption text-muted-foreground'
                  >
                    <span className='rounded-sm border border-border px-1 text-caption'>
                      {intl.formatMessage({
                        id: 'memory.merge.mergeBadge',
                        defaultMessage: 'merge',
                      })}
                    </span>
                    <span className='truncate'>{snippet(s)}</span>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
