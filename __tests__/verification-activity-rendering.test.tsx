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
      // M-3 (Task 7 review): activity.contractConfirmed needs real ICU plural
      // ("1 criterion" vs "N criteria") — mirror AcceptanceTab.test.tsx's mock
      // instead of working around the limitation with awkward copy.
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          return (n === 1 ? one : other).replace('#', String(n))
        }
      )
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

// LUM-789: confirming the acceptance contract renders through its own case —
// and `confirmedCount` must not be shown as one comparable number across
// `via` (web/cli count only newly-stamped rows; HUMAN_EDIT counts every row
// the revision touched, including a re-stamped already-confirmed one).
describe('CONTRACT_CONFIRMED', () => {
  it('renders the confirmed count for a web confirmation', () => {
    renderItem(
      entry('CONTRACT_CONFIRMED', {
        via: 'web',
        confirmedCount: 2,
        criterionIds: ['c1', 'c2'],
        reconfirm: false,
      })
    )
    // M-3 (Task 7 review): ICU plural, not "N of the acceptance criteria" —
    // the latter read as partial even at full coverage.
    expect(
      screen.getByText(/confirmed 2 acceptance criteria/)
    ).toBeInTheDocument()
    expect(screen.queryByText('contract confirmed')).not.toBeInTheDocument()
  })

  it('marks a CLI confirmation distinctly', () => {
    renderItem(
      entry('CONTRACT_CONFIRMED', {
        via: 'cli',
        confirmedCount: 1,
        criterionIds: ['c1'],
        reconfirm: false,
      })
    )
    // Singular ICU branch: "criterion", not "criteria" (the two words don't
    // collide as substrings, so this alone proves the branch taken).
    expect(
      screen.getByText(/confirmed 1 acceptance criterion/)
    ).toBeInTheDocument()
    expect(screen.getByText(/via CLI/)).toBeInTheDocument()
  })

  it('omits the count for a HUMAN_EDIT auto-confirm — that number counts every touched row, not just new stamps', () => {
    renderItem(
      entry('CONTRACT_CONFIRMED', {
        via: 'HUMAN_EDIT',
        confirmedCount: 5,
        criterionIds: ['c1'],
        reconfirm: true,
      })
    )
    expect(
      screen.getByText(/confirmed the acceptance contract \(via edit\)/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/5/)).not.toBeInTheDocument()
  })
})
