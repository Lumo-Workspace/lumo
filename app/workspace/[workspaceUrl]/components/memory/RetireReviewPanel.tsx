'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Archive } from 'lucide-react'
import type { MemoryRow, RetireCandidate, RetireReason } from '@/lib/api-client'
import { memoryContentToText } from '@/lib/memory/content-text'
import { Button } from '@/components/ui/button'

interface RetireReviewPanelProps {
  candidates: RetireCandidate[]
  /** id → memory row, for the one-line snippet. Candidates missing here are skipped. */
  memoriesById: Map<string, MemoryRow>
  onConfirm: (memoryId: string) => Promise<unknown>
  confirming: boolean
}

const REASON_LABELS: Record<
  RetireReason,
  { id: string; defaultMessage: string }
> = {
  'low-judged-used': {
    id: 'memory.retire.reason.lowJudgedUsed',
    defaultMessage: 'rarely used',
  },
  contradiction: {
    id: 'memory.retire.reason.contradiction',
    defaultMessage: 'contradicts current state',
  },
  'stale-anchor': {
    id: 'memory.retire.reason.staleAnchor',
    defaultMessage: 'references deleted code',
  },
}

const ANCHOR_KIND_LABELS: Record<
  string,
  { id: string; defaultMessage: string }
> = {
  file: { id: 'memory.retire.anchor.file', defaultMessage: 'file' },
  symbol: { id: 'memory.retire.anchor.symbol', defaultMessage: 'symbol' },
  flag: { id: 'memory.retire.anchor.flag', defaultMessage: 'flag' },
}

/**
 * LUM-540 (P4a) — the human review surface for proposed memory retirements. Each
 * candidate shows WHY it was flagged (low judged-used track record / clearly-
 * wrong) and a human chooses Retire (→ archived via the existing status machine,
 * reversible — 失效非删) or Keep (dismissed locally this session; candidacy is
 * derived, so it may resurface until the memory earns usage). The agent/CLI has
 * no confirm path — the server refuses a non-human caller 403.
 */
export function RetireReviewPanel({
  candidates,
  memoriesById,
  onConfirm,
  confirming,
}: RetireReviewPanelProps) {
  const intl = useIntl()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = candidates.filter(
    c => !dismissed.has(c.memoryId) && memoriesById.has(c.memoryId)
  )
  if (visible.length === 0) return null

  const handleConfirm = async (memoryId: string) => {
    try {
      await onConfirm(memoryId)
      toast.success(
        intl.formatMessage({
          id: 'memory.retire.confirmed',
          defaultMessage: 'Memory retired',
        })
      )
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'memory.retire.error',
          defaultMessage: 'Could not retire the memory. Please try again.',
        })
      )
    }
  }

  const dismiss = (memoryId: string) =>
    setDismissed(prev => new Set(prev).add(memoryId))

  return (
    <div className='rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-2'>
      <div className='flex items-center gap-1.5 text-caption text-muted-foreground'>
        <Archive className='size-3.5' />
        {intl.formatMessage(
          {
            id: 'memory.retire.heading',
            defaultMessage:
              '{count, plural, one {# memory proposed for retirement} other {# memories proposed for retirement}}',
          },
          { count: visible.length }
        )}
      </div>
      <p className='text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'memory.retire.description',
          defaultMessage:
            'Retiring keeps the memory for audit and is reversible. Keep leaves it active.',
        })}
      </p>
      <ul className='space-y-1.5'>
        {visible.map(c => {
          const memory = memoriesById.get(c.memoryId)!
          const snippet = memoryContentToText(memory.category, memory.content)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100)
          return (
            <li
              key={c.memoryId}
              className='flex items-center justify-between gap-2 rounded-sm bg-background/60 px-2 py-1.5'
            >
              <div className='min-w-0 flex-1'>
                <p className='truncate text-caption text-foreground'>
                  {snippet}
                </p>
                <div className='mt-0.5 flex flex-wrap gap-1'>
                  {c.reasons.map(r => {
                    const label = REASON_LABELS[r]
                    if (!label) return null
                    return (
                      <span
                        key={r}
                        className='rounded-sm border border-border px-1 text-caption text-muted-foreground'
                      >
                        {intl.formatMessage(label)}
                      </span>
                    )
                  })}
                </div>
                {c.staleAnchors && c.staleAnchors.length > 0 && (
                  <p className='mt-0.5 truncate font-mono text-caption text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'memory.retire.anchor.deadLabel',
                      defaultMessage: 'gone:',
                    })}{' '}
                    {c.staleAnchors
                      .map(a => {
                        const kind = ANCHOR_KIND_LABELS[a.kind]
                        const kindLabel = kind
                          ? intl.formatMessage(kind)
                          : a.kind
                        return `${a.value} (${kindLabel})`
                      })
                      .join(', ')}
                  </p>
                )}
              </div>
              <div className='flex shrink-0 gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 px-2 text-caption'
                  onClick={() => dismiss(c.memoryId)}
                >
                  {intl.formatMessage({
                    id: 'memory.retire.dismiss',
                    defaultMessage: 'Keep',
                  })}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  className='h-6 px-2 text-caption'
                  disabled={confirming}
                  onClick={() => handleConfirm(c.memoryId)}
                >
                  {intl.formatMessage({
                    id: 'memory.retire.confirm',
                    defaultMessage: 'Retire',
                  })}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
