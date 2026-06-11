/** @jest-environment jsdom */
/**
 * LUM-423: the acceptance mirror layer floods the timeline (one row per drafted
 * criterion, one row per criterion per verify round). These tests pin the
 * render-layer fold: the pure `aggregateTimeline` pass (describe 'aggregation')
 * and the collapsed batch row's expand/collapse interaction (describe 'expand').
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      // minimal ICU plural support for {n, plural, one {# x} other {# y}}
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          const pick = n === 1 ? one : other
          return pick.replace('#', String(n))
        }
      )
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TimelineEntry } from '@/app/workspace/[workspaceUrl]/types'
import {
  aggregateTimeline,
  type CriterionBatchUnit,
  type VerificationBatchUnit,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/acceptance-aggregation'
import { AcceptanceBatchItem } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/AcceptanceBatchItem'

let seq = 0
function criterionChanged(
  opts: {
    at: string
    source?: 'AGENT_DRAFT' | 'HUMAN_EDIT'
    verifierType?: 'MACHINE' | 'HUMAN'
    op?: 'ADDED' | 'UPDATED' | 'DELETED'
    statement?: string
    round?: number
  }
): TimelineEntry {
  return {
    id: `c-${seq++}`,
    kind: 'activity',
    type: 'CRITERION_CHANGED',
    actorId: 'actor-1',
    createdAt: opts.at,
    payload: {
      op: opts.op ?? 'ADDED',
      criterionId: `crit-${seq}`,
      source: opts.source ?? 'AGENT_DRAFT',
      round: opts.round ?? 0,
      after: {
        statement: opts.statement ?? 'some criterion',
        verifierType: opts.verifierType ?? 'MACHINE',
        checkpointer: null,
        evidenceRequired: false,
      },
      before: null,
    },
  }
}

function verificationRun(opts: {
  at: string
  round: number
  verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
  verifierType?: 'MACHINE' | 'HUMAN' | 'AGENT'
  statement?: string
  evidencePointer?: string | null
  commentId?: string | null
}): TimelineEntry {
  const payload: Record<string, unknown> = {
    criterionId: `crit-${seq++}`,
    statement: opts.statement ?? 'a criterion',
    round: opts.round,
    verdict: opts.verdict,
    evidencePointer: opts.evidencePointer ?? null,
  }
  // The machine path omits verifierType (implicit MACHINE); mirror that.
  if (opts.verifierType && opts.verifierType !== 'MACHINE') {
    payload.verifierType = opts.verifierType
  }
  if (opts.commentId) payload.commentId = opts.commentId
  return {
    id: `v-${seq++}`,
    kind: 'activity',
    type: 'VERIFICATION_RUN_RECORDED',
    actorId: 'actor-1',
    createdAt: opts.at,
    payload,
  }
}

function comment(at: string): TimelineEntry {
  return {
    id: `cm-${seq++}`,
    kind: 'comment',
    body: 'hello',
    authorActorId: 'actor-1',
    parentId: null,
    quotedCommentId: null,
    type: 'comment',
    createdAt: at,
    updatedAt: at,
  }
}

beforeEach(() => {
  seq = 0
})

describe('aggregation', () => {
  it('folds a 6-criterion draft (one transaction) into a single batch row', () => {
    const at = '2026-06-10T12:00:00.000Z'
    const entries: TimelineEntry[] = [
      criterionChanged({ at, verifierType: 'MACHINE' }),
      criterionChanged({ at, verifierType: 'MACHINE' }),
      criterionChanged({ at, verifierType: 'MACHINE' }),
      criterionChanged({ at, verifierType: 'MACHINE' }),
      criterionChanged({ at, verifierType: 'HUMAN' }),
      criterionChanged({ at, verifierType: 'HUMAN' }),
    ]
    const units = aggregateTimeline(entries)
    expect(units).toHaveLength(1)
    const u = units[0]!
    expect(u.kind).toBe('criterion-batch')
    if (u.kind !== 'criterion-batch') throw new Error('wrong kind')
    expect(u.total).toBe(6)
    expect(u.machineCount).toBe(4)
    expect(u.humanCount).toBe(2)
    expect(u.source).toBe('AGENT_DRAFT')
    expect(u.items).toHaveLength(6)
  })

  it('keeps two separate transactions of the same source in separate rows', () => {
    const entries: TimelineEntry[] = [
      criterionChanged({ at: '2026-06-10T12:00:00.000Z' }),
      criterionChanged({ at: '2026-06-10T12:00:30.000Z', source: 'HUMAN_EDIT' }),
    ]
    const units = aggregateTimeline(entries)
    expect(units).toHaveLength(2)
    expect(units.every(u => u.kind === 'criterion-batch')).toBe(true)
  })

  it('groups a verify round by (round, verifierType) and marks tone success when all pass', () => {
    const at = '2026-06-10T13:00:00.000Z'
    const units = aggregateTimeline([
      verificationRun({ at, round: 1, verdict: 'PASS' }),
      verificationRun({ at, round: 1, verdict: 'PASS' }),
      verificationRun({ at, round: 1, verdict: 'PASS' }),
    ])
    expect(units).toHaveLength(1)
    const u = units[0]!
    if (u.kind !== 'verification-batch') throw new Error('wrong kind')
    expect(u.round).toBe(1)
    expect(u.verifierType).toBe('MACHINE')
    expect(u.passed).toBe(3)
    expect(u.failed).toBe(0)
    expect(u.total).toBe(3)
    expect(u.tone).toBe('success')
  })

  it('marks tone danger when any criterion in the round failed', () => {
    const at = '2026-06-10T13:05:00.000Z'
    const units = aggregateTimeline([
      verificationRun({ at, round: 2, verdict: 'PASS' }),
      verificationRun({ at, round: 2, verdict: 'FAIL' }),
    ])
    const u = units[0]!
    if (u.kind !== 'verification-batch') throw new Error('wrong kind')
    expect(u.tone).toBe('danger')
    expect(u.passed).toBe(1)
    expect(u.failed).toBe(1)
  })

  it('separates a machine round from a human/agent send-back in the same round, and surfaces the comment link', () => {
    const at = '2026-06-10T14:00:00.000Z'
    const units = aggregateTimeline([
      verificationRun({ at, round: 1, verdict: 'PASS' }),
      verificationRun({
        at,
        round: 1,
        verdict: 'FAIL',
        verifierType: 'AGENT',
        commentId: 'comment-xyz',
      }),
    ])
    expect(units).toHaveLength(2)
    const machine = units[0]!
    const agent = units[1]!
    if (machine.kind !== 'verification-batch') throw new Error('wrong kind')
    if (agent.kind !== 'verification-batch') throw new Error('wrong kind')
    expect(machine.verifierType).toBe('MACHINE')
    expect(machine.commentId).toBeNull()
    expect(agent.verifierType).toBe('AGENT')
    expect(agent.tone).toBe('danger')
    expect(agent.commentId).toBe('comment-xyz')
  })

  it('passes non-acceptance entries through and flushes an open batch first', () => {
    const at = '2026-06-10T15:00:00.000Z'
    const units = aggregateTimeline([
      criterionChanged({ at }),
      criterionChanged({ at }),
      comment(at),
      verificationRun({ at, round: 1, verdict: 'PASS' }),
    ])
    expect(units.map(u => u.kind)).toEqual([
      'criterion-batch',
      'entry',
      'verification-batch',
    ])
  })

  it('leaves VERIFICATION_ESCALATED as its own standalone milestone row', () => {
    const at = '2026-06-10T16:00:00.000Z'
    const escalated: TimelineEntry = {
      id: 'esc-1',
      kind: 'activity',
      type: 'VERIFICATION_ESCALATED',
      actorId: null,
      createdAt: at,
      payload: { round: 3 },
    }
    const units = aggregateTimeline([escalated])
    expect(units).toHaveLength(1)
    expect(units[0]!.kind).toBe('entry')
  })
})

function renderBatch(unit: CriterionBatchUnit | VerificationBatchUnit) {
  return render(
    <TooltipProvider>
      <AcceptanceBatchItem unit={unit} members={[]} agentActors={[]} />
    </TooltipProvider>
  )
}

function asCriterionBatch(entries: TimelineEntry[]): CriterionBatchUnit {
  const u = aggregateTimeline(entries)[0]!
  if (u.kind !== 'criterion-batch') throw new Error('expected criterion-batch')
  return u
}

function asVerificationBatch(entries: TimelineEntry[]): VerificationBatchUnit {
  const u = aggregateTimeline(entries)[0]!
  if (u.kind !== 'verification-batch')
    throw new Error('expected verification-batch')
  return u
}

describe('expand', () => {
  it('renders the collapsed summary and reveals per-criterion detail on click', () => {
    const at = '2026-06-10T12:00:00.000Z'
    const unit = asCriterionBatch([
      criterionChanged({ at, statement: 'first criterion text' }),
      criterionChanged({ at, statement: 'second criterion text' }),
    ])
    renderBatch(unit)

    // Collapsed: summary visible, per-item detail hidden.
    const toggle = screen.getByRole('button', { expanded: false })
    expect(toggle).toHaveTextContent('2 criteria')
    expect(screen.queryByText('first criterion text')).toBeNull()

    fireEvent.click(toggle)

    // Expanded: aria flips and each item's statement is now in the DOM.
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    expect(screen.getByText('first criterion text')).toBeInTheDocument()
    expect(screen.getByText('second criterion text')).toBeInTheDocument()

    // Collapse again hides detail.
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByText('first criterion text')).toBeNull()
  })

  it('shows the verdict tone chip and the per-criterion evidencePointer on expand', () => {
    const at = '2026-06-10T13:00:00.000Z'
    const unit = asVerificationBatch([
      verificationRun({
        at,
        round: 1,
        verdict: 'PASS',
        statement: 'route returns 409',
        evidencePointer: 'jest: criteria.service ✓',
      }),
    ])
    renderBatch(unit)

    expect(screen.getByText('PASS')).toBeInTheDocument()
    expect(screen.queryByText(/jest: criteria.service/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('route returns 409')).toBeInTheDocument()
    expect(screen.getByText(/jest: criteria.service/)).toBeInTheDocument()
  })

  it('exposes a view-reason link on an agent send-back row', () => {
    const at = '2026-06-10T14:00:00.000Z'
    const unit = asVerificationBatch([
      verificationRun({
        at,
        round: 2,
        verdict: 'FAIL',
        verifierType: 'AGENT',
        commentId: 'comment-abc',
      }),
    ])
    renderBatch(unit)

    const link = screen.getByRole('link', { name: 'view reason comment' })
    expect(link).toHaveAttribute('href', '#comment-comment-abc')
    expect(screen.getByText('FAIL')).toBeInTheDocument()
  })

  it('renders a machine round without a send-back link', () => {
    const at = '2026-06-10T15:00:00.000Z'
    const unit = asVerificationBatch([
      verificationRun({ at, round: 1, verdict: 'PASS' }),
      verificationRun({ at, round: 1, verdict: 'PASS' }),
    ])
    renderBatch(unit)

    expect(screen.getByText(/machine check · round 1 · 2\/2 passed/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'view reason comment' })).toBeNull()
  })
})
