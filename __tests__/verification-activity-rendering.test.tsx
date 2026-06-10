/** @jest-environment jsdom */
/**
 * LUM-343: the new TaskActivityType values must render through dedicated
 * cases in the activity timeline — not the raw lowercase default branch
 * (the HookEventType↔categorize trap, applied to TaskActivity).
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CompactActivityItem } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem'
import type { TimelineActivityEntry } from '@/app/workspace/[workspaceUrl]/types'

function entry(
  type: string,
  payload: Record<string, unknown>
): TimelineActivityEntry {
  return {
    id: 'a-1',
    kind: 'activity',
    type,
    payload,
    actorId: null,
    createdAt: new Date().toISOString(),
  }
}

function renderItem(e: TimelineActivityEntry) {
  return render(
    <TooltipProvider>
      <CompactActivityItem entry={e} members={[]} agentActors={[]} />
    </TooltipProvider>
  )
}

describe('VERIFICATION_RUN_RECORDED', () => {
  it('renders verdict, round, and the criterion statement', () => {
    renderItem(
      entry('VERIFICATION_RUN_RECORDED', {
        criterionId: 'c-1',
        statement: 'route rejects bad input',
        round: 2,
        verdict: 'FAIL',
      })
    )
    expect(
      screen.getByText(/machine check FAIL \(round 2\)/)
    ).toBeInTheDocument()
    expect(screen.getByText(/route rejects bad input/)).toBeInTheDocument()
    // not the default branch
    expect(
      screen.queryByText('verification run recorded')
    ).not.toBeInTheDocument()
  })
})

describe('VERIFICATION_ESCALATED', () => {
  it('renders the escalation message with the round', () => {
    renderItem(entry('VERIFICATION_ESCALATED', { round: 3, maxRounds: 3 }))
    expect(
      screen.getByText(/machine verification exhausted after round 3/)
    ).toBeInTheDocument()
    expect(screen.queryByText('verification escalated')).not.toBeInTheDocument()
  })
})

describe('CRITERION_CHANGED', () => {
  it.each([
    ['ADDED', 'added an acceptance criterion'],
    ['UPDATED', 'updated an acceptance criterion'],
    ['DELETED', 'deleted an acceptance criterion'],
  ])('renders %s with its label and statement', (op, label) => {
    renderItem(
      entry('CRITERION_CHANGED', {
        op,
        criterionId: 'c-1',
        source: 'HUMAN_EDIT',
        round: 1,
        before: op === 'ADDED' ? null : { statement: 'old statement' },
        after: op === 'DELETED' ? null : { statement: 'new statement' },
      })
    )
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
    expect(
      screen.getByText(op === 'DELETED' ? /old statement/ : /new statement/)
    ).toBeInTheDocument()
    expect(screen.queryByText('criterion changed')).not.toBeInTheDocument()
  })
})
