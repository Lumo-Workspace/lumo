/** @jest-environment jsdom */
/**
 * LUM-751 — the acceptance panel's repository-rule affordances: an
 * AUTO_SUPPRESSED crossing reads as system-handled by a named rule with a
 * one-click revoke; the false-positive action offers the per-repository
 * auto-handle opt-in only for suppressible crossings.
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
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    revokeCrossingSuppressionRule: jest.fn().mockResolvedValue({}),
  },
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import { tasksClient } from '@/lib/api-client'

const mockHook = useBoundaryCrossings as jest.Mock
const mockDisposition = tasksClient.dispositionBoundaryCrossing as jest.Mock
const mockRevoke = tasksClient.revokeCrossingSuppressionRule as jest.Mock
const refresh = jest.fn()

const BASE = {
  detail: 'gh pr create --base main --title x',
  detectedAt: '2026-09-10T00:00:00.000Z',
  reversible: false,
  severity: 'MEDIUM',
  disposition: null,
  dispositionNote: null,
  dispositionedAt: null,
  dispositionedById: null,
  remediationTask: null,
  editChange: null,
  lastDispositionChange: null,
  attribution: {
    workspaceMemberId: null,
    sessionId: null,
    agent: null,
    worktreeBranch: null,
    model: null,
  },
  explanations: [],
  advisory: false,
  policyRuleRef: null,
  policyRuleText: null,
  agentContext: null,
  systemExplanation: null,
  suppressionRule: null,
}

function setCrossings(crossings: unknown[]) {
  mockHook.mockReturnValue({ crossings, loading: false, error: null, refresh })
}
const openGroup = (category: string) =>
  fireEvent.click(screen.getByTestId(`crossing-group-${category}`))

beforeEach(() => jest.clearAllMocks())

describe('LUM-751 — repository suppression rules in the panel', () => {
  it('an AUTO_SUPPRESSED crossing shows the rule badge with reason and a Revoke button that calls the revoke API', async () => {
    setCrossings([
      {
        ...BASE,
        id: 'bc-s',
        category: 'PROJECT_RULE_VIOLATION',
        disposition: 'AUTO_SUPPRESSED',
        dispositionedAt: '2026-09-10T00:00:00.000Z',
        dispositionNote: 'Auto-dispositioned by repository suppression rule',
        suppressible: true,
        suppressionRule: {
          id: 'rule-1abcdef',
          reason: 'PR target branch',
          revokedAt: null,
        },
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-751' enabled />)
    // all crossings dispositioned — expand the panel, open the group + row
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    openGroup('PROJECT_RULE_VIOLATION')
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-s'))

    expect(
      screen.getAllByText(/auto-dispositioned by/i).length
    ).toBeGreaterThan(0)
    expect(screen.getByText(/PR target branch/)).toBeInTheDocument()
    // no human-disposition buttons on a system-dispositioned row
    expect(screen.queryByTestId('boundary-false-positive-bc-s')).toBeNull()

    fireEvent.click(screen.getByTestId('boundary-revoke-rule-bc-s'))
    await waitFor(() =>
      expect(mockRevoke).toHaveBeenCalledWith('LUM-751', 'rule-1abcdef')
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('a revoked rule reads as revoked and offers no second revoke', () => {
    setCrossings([
      {
        ...BASE,
        id: 'bc-r',
        category: 'PROJECT_RULE_VIOLATION',
        disposition: 'AUTO_SUPPRESSED',
        dispositionedAt: '2026-09-10T00:00:00.000Z',
        suppressible: true,
        suppressionRule: {
          id: 'rule-2',
          reason: null,
          revokedAt: '2026-09-11T00:00:00.000Z',
        },
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-751' enabled />)
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    openGroup('PROJECT_RULE_VIOLATION')
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-r'))
    expect(screen.getByText(/rule revoked/i)).toBeInTheDocument()
    expect(screen.queryByTestId('boundary-revoke-rule-bc-r')).toBeNull()
  })

  it('the auto-handle opt-in appears on a suppressible open crossing and rides the FALSE_POSITIVE call', async () => {
    setCrossings([
      {
        ...BASE,
        id: 'bc-p',
        category: 'PROJECT_RULE_VIOLATION',
        suppressible: true,
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-751' enabled />)
    fireEvent.click(screen.getByTestId('boundary-suppress-similar-bc-p'))
    fireEvent.change(screen.getByTestId('boundary-suppress-reason-bc-p'), {
      target: { value: 'PR target' },
    })
    fireEvent.click(screen.getByTestId('boundary-false-positive-bc-p'))
    await waitFor(() =>
      expect(mockDisposition).toHaveBeenCalledWith(
        'LUM-751',
        'bc-p',
        'FALSE_POSITIVE',
        undefined,
        { suppressSimilarInProject: true, suppressionReason: 'PR target' }
      )
    )
  })

  it('without the opt-in the disposition call keeps its plain shape', async () => {
    setCrossings([
      {
        ...BASE,
        id: 'bc-q',
        category: 'PROJECT_RULE_VIOLATION',
        suppressible: true,
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-751' enabled />)
    fireEvent.click(screen.getByTestId('boundary-false-positive-bc-q'))
    await waitFor(() =>
      expect(mockDisposition).toHaveBeenCalledWith(
        'LUM-751',
        'bc-q',
        'FALSE_POSITIVE',
        undefined
      )
    )
  })

  it('no opt-in on a non-suppressible (HARDCODED_SECRET) crossing', () => {
    setCrossings([
      {
        ...BASE,
        id: 'bc-h',
        category: 'HARDCODED_SECRET',
        detail: 'AWS access key id in lib/x.ts',
        severity: 'HIGH',
        suppressible: false,
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-751' enabled />)
    expect(
      screen.getByTestId('boundary-false-positive-bc-h')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('boundary-suppress-similar-bc-h')).toBeNull()
  })
})
