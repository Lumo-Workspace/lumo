/** @jest-environment jsdom */
/**
 * LUM-635: the boundary-crossings panel is promoted out of the collapsed
 * "Evidence & audit trail" fold to a third zone (sibling of the human/machine
 * criteria zones). An open crossing is a human-only to-do that blocks Done —
 * a policy gate, not after-the-fact evidence — so it must not hide behind a
 * default-collapsed fold (which also made the verdict bar's
 * #boundary-crossings anchor a dead link). The zone header mirrors the other
 * zones' grammar (state accent + subtitle + dispositioned/total count), and
 * the blocking subset mirrors the server gate: advisory never blocks, HIGH
 * always blocks, MEDIUM/LOW respect the workspace opt-out (gateEnabled).
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          return (n === 1 ? one : other).replace('#', String(n))
        }
      )
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    submitHumanVerdict: jest.fn().mockResolvedValue({}),
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    explainBoundaryCrossing: jest.fn().mockResolvedValue({}),
  },
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

import '@testing-library/jest-dom'
import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockCrossings = useBoundaryCrossings as jest.Mock

function makeCrossing(over: Record<string, unknown>) {
  return {
    id: 'bc-x',
    category: 'DESTRUCTIVE_DB_COMMAND',
    detail: 'prisma migrate reset --force',
    detectedAt: '2026-06-11T00:00:00.000Z',
    reversible: false,
    occurrenceCount: 1,
    lastSeenAt: '2026-06-11T00:00:00.000Z',
    severity: 'HIGH',
    disposition: null,
    dispositionNote: null,
    dispositionedAt: null,
    dispositionedById: null,
    remediationTask: null,
    editChange: null,
    lastDispositionChange: null,
    attribution: null,
    explanations: [],
    advisory: false,
    policyRuleRef: null,
    policyRuleText: null,
    agentContext: null,
    systemExplanation: null,
    ...over,
  }
}

function setCrossings(crossings: unknown[], gateEnabled = true) {
  mockCrossings.mockReturnValue({
    crossings,
    gateEnabled,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function machineCriterion(): TaskStatusCriterionView {
  return {
    id: 'm1',
    statement: 'route returns 409 on lock',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest lock.test.ts',
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: null,
    machineVerdict: null,
    machinePassed: false,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
  }
}

function setStatus() {
  const data: TaskAcceptanceStatusView = {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_PROGRESS' },
    currentRound: 0,
    maxRounds: 3,
    escalated: false,
    criteria: [machineCriterion()],
    machineVerification: { total: 1, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
  }
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

const summaryToggle = () => screen.getByTestId('boundary-summary-toggle')

beforeEach(() => jest.clearAllMocks())

it('boundary crossings zone renders outside the audit fold with a persistent anchor', () => {
  setStatus()
  setCrossings([makeCrossing({ id: 'bc-1' })])
  render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
      gatesSlot={<div data-testid='gates-slot' />}
    />
  )

  // The anchor exists while the audit fold is still collapsed (its content —
  // the injected gates slot — is not mounted), so the verdict bar's
  // "View crossings" #boundary-crossings link always has a live target.
  const panel = document.getElementById('boundary-crossings')
  expect(panel).toBeInTheDocument()
  expect(screen.queryByTestId('gates-slot')).not.toBeInTheDocument()

  // Expand the fold: the forensic signals mount, and the panel is NOT among
  // them — it precedes the fold in the document.
  const foldToggle = screen.getByTestId('audit-only-divider').closest('button')!
  fireEvent.click(foldToggle)
  expect(screen.getByTestId('gates-slot')).toBeInTheDocument()
  expect(document.querySelectorAll('#boundary-crossings')).toHaveLength(1)
  expect(
    panel!.compareDocumentPosition(screen.getByTestId('gates-slot')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(foldToggle.contains(panel)).toBe(false)
})

it('zone header reflects blocking vs converged disposition state', () => {
  // Blocking: one open HIGH among two dispositioned — danger accent, expanded
  // by default, "blocks Done" subtitle, dispositioned/total count.
  setCrossings([
    makeCrossing({ id: 'bc-1', severity: 'HIGH' }),
    makeCrossing({
      id: 'bc-2',
      disposition: 'FALSE_POSITIVE',
      dispositionedAt: '2026-06-11T01:00:00.000Z',
    }),
    makeCrossing({
      id: 'bc-3',
      disposition: 'CONFIRMED',
      dispositionedAt: '2026-06-11T02:00:00.000Z',
    }),
  ])
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-1' enabled />)
  expect(
    screen.getByText('1 open — blocks Done until dispositioned')
  ).toBeInTheDocument()
  expect(summaryToggle()).toHaveAttribute('aria-expanded', 'true')
  expect(summaryToggle().className).toContain('bg-danger-subtle')
  expect(screen.getByText('2/3')).toBeInTheDocument()
  cleanup()

  // Converged: everything dispositioned — neutral (not success, not danger),
  // collapsed by default, "none blocking" subtitle, N/N count.
  setCrossings([
    makeCrossing({ id: 'bc-1', disposition: 'FALSE_POSITIVE' }),
    makeCrossing({ id: 'bc-2', disposition: 'CONFIRMED' }),
    makeCrossing({ id: 'bc-3', disposition: 'AUTO_LEGIT' }),
  ])
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-1' enabled />)
  expect(
    screen.getByText('All 3 dispositioned — none blocking')
  ).toBeInTheDocument()
  expect(summaryToggle()).toHaveAttribute('aria-expanded', 'false')
  expect(summaryToggle().className).not.toContain('danger')
  expect(summaryToggle().className).not.toContain('success')
  expect(screen.getByText('3/3')).toBeInTheDocument()
  cleanup()

  // Workspace opt-out (gateEnabled=false): an open MEDIUM does NOT block —
  // non-blocking subtitle, no danger accent.
  setCrossings([makeCrossing({ id: 'bc-1', severity: 'MEDIUM' })], false)
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-1' enabled />)
  expect(screen.getByText('1 open — non-blocking')).toBeInTheDocument()
  expect(summaryToggle().className).not.toContain('danger')
  expect(screen.getByText('0/1')).toBeInTheDocument()
  cleanup()

  // …but an open HIGH blocks even under the opt-out (LUM-442).
  setCrossings([makeCrossing({ id: 'bc-1', severity: 'HIGH' })], false)
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-1' enabled />)
  expect(
    screen.getByText('1 open — blocks Done until dispositioned')
  ).toBeInTheDocument()
  cleanup()

  // Advisory open crossings never block (LUM-590).
  setCrossings([makeCrossing({ id: 'bc-1', severity: 'HIGH', advisory: true })])
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-1' enabled />)
  expect(screen.getByText('1 open — non-blocking')).toBeInTheDocument()
})

it('audit-only caption key is removed from all locales and code', () => {
  // Assembled at runtime so this tracked file never self-hits the scan
  // (the git-grep self-reference trap).
  const key = ['acceptance', 'auditOnly', 'notVerdict'].join('.')

  const i18nDir = path.join(process.cwd(), 'lib', 'i18n')
  const locales = fs.readdirSync(i18nDir).filter(f => f.endsWith('.json'))
  expect(locales.length).toBeGreaterThanOrEqual(16)
  for (const f of locales) {
    const json = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8'))
    expect(key in json).toBe(false)
  }

  const roots = ['app', 'components'].map(d => path.join(process.cwd(), d))
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        if (fs.readFileSync(p, 'utf8').includes(key)) offenders.push(p)
      }
    }
  }
  roots.forEach(walk)
  expect(offenders).toEqual([])
})

it('single panel keeps open and dispositioned crossings with the defense-in-depth disclaimer', () => {
  setCrossings([
    makeCrossing({ id: 'bc-open', severity: 'HIGH' }),
    makeCrossing({
      id: 'bc-done',
      category: 'TEST_TAMPERING',
      severity: 'MEDIUM',
      disposition: 'CONFIRMED',
      dispositionedAt: '2026-06-11T01:00:00.000Z',
    }),
  ])
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-1' enabled />)

  // LUM-542 invariant: OPEN and dispositioned rows live in the SAME panel —
  // adjudication context and the retrospective record in one place, and a
  // confirmed crossing is never hidden.
  const panel = document.getElementById('boundary-crossings')!
  expect(panel.contains(screen.getByTestId('crossing-toggle-bc-open'))).toBe(
    true
  )
  // LUM-496: the settled crossing sits in its own (collapsed) category group —
  // still the SAME panel, one fold away.
  fireEvent.click(screen.getByTestId('crossing-group-TEST_TAMPERING'))
  expect(panel.contains(screen.getByTestId('crossing-toggle-bc-done'))).toBe(
    true
  )

  // The defense-in-depth framing survives the zone restyle.
  expect(
    screen.getByText(/Defense-in-depth, not a hard boundary/)
  ).toBeInTheDocument()
})
