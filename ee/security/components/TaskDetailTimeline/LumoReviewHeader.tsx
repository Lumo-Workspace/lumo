'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TaskSecurityScans } from '@/ee/security/services/pr-security-scan.service'
import { reviewVerdict, type ReviewVerdict } from './lumo-review-checks'
import { agentContextForReview } from './security-agent-context'

const VERDICT_BADGE: Record<ReviewVerdict['kind'], BadgeProps['variant']> = {
  blocking: 'danger',
  open: 'warning',
  scanning: 'info',
  notFullyChecked: 'warning',
  preMerge: 'warning',
  turnedOff: 'muted',
  notScanned: 'muted',
  clean: 'success',
}

/**
 * LUM-1308 — the Lumo review card header's verdict: one badge (blocks Done,
 * to decide, scanning, not fully checked, clean…) and, with more than one
 * PR, how many. The PR's link and commit open the report below it.
 */
export function LumoReviewSummary({ data }: { data: TaskSecurityScans }) {
  const intl = useIntl()
  const verdict = reviewVerdict(data)
  const Icon =
    verdict.kind === 'scanning'
      ? Loader2
      : verdict.kind === 'clean'
        ? Check
        : null
  return (
    <span className='inline-flex flex-wrap items-center gap-x-2 gap-y-1'>
      <Badge
        data-testid='lumo-review-verdict'
        data-verdict={verdict.kind}
        variant={VERDICT_BADGE[verdict.kind]}
        size='sm'
      >
        {Icon ? (
          <Icon
            className={`size-3${verdict.kind === 'scanning' ? ' animate-spin' : ''}`}
            aria-hidden
          />
        ) : null}
        {intl.formatMessage(
          { id: `lumoReview.verdict.${verdict.kind}` },
          'count' in verdict ? { count: verdict.count } : undefined
        )}
      </Badge>
      {data.prs.length > 1 && (
        <span className='text-body text-muted-foreground'>
          {intl.formatMessage(
            { id: 'lumoReview.pr.count' },
            { count: data.prs.length }
          )}
        </span>
      )}
    </span>
  )
}

/** LUM-1308 — the header's "Copy for agent": every open finding at once. */
export function CopyReviewForAgent({ data }: { data: TaskSecurityScans }) {
  const intl = useIntl()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const context = agentContextForReview(data)
  if (!context) return null
  async function copy() {
    try {
      await navigator.clipboard.writeText(context)
    } catch {
      // Said out loud: the button would otherwise look like it worked. The
      // line clears on its own, like "Copied".
      setCopied(false)
      setFailed(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setFailed(false), 4000)
      return
    }
    setFailed(false)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }
  return (
    <span className='inline-flex items-center gap-2'>
      {failed && (
        <span role='alert' className='text-caption text-danger-text'>
          {intl.formatMessage({ id: 'lumoReview.copyFailed' })}
        </span>
      )}
      <Button
        type='button'
        variant='outline'
        size='sm'
        data-testid='lumo-review-copy'
        onClick={() => void copy()}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {intl.formatMessage({
          id: copied
            ? 'securityScan.action.copied'
            : 'securityScan.action.copyForAgent',
        })}
      </Button>
    </span>
  )
}
