/** @jest-environment jsdom */
/**
 * LUM-1062 — with the security plugin installed, the slots render what the
 * core components rendered before the split: the dossier hands RecordTab the
 * same gate signal, blocker and Records row; each PR gets its scan badge
 * (nothing while loading); the settings card and the evidence row read the
 * plugin's columns; the triage line shows once a crossing has a score.
 */
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
    formatNumber: (n: number) => String(n),
  }),
}))

const useSecurityScans = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SecurityScanSection',
  () => ({
    SecurityScanSection: ({ taskId }: { taskId: string }) => (
      <div data-testid='scan-section'>{taskId}</div>
    ),
    BlockingSecurityFindings: ({ taskId }: { taskId: string }) => (
      <div data-testid='blocking-findings'>{taskId}</div>
    ),
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary-line',
  () => ({
    formatSecurityVerdict: () => ({ text: 'verdict', caveats: [] }),
  })
)
jest.mock('@/ee/security/ui/pr-scan-badge', () => ({
  SecurityScanBadge: ({
    scan,
    unavailable,
  }: {
    scan?: { status: string } | null
    unavailable?: boolean
  }) => (
    <span
      data-testid='security-scan-badge'
      data-unavailable={String(!!unavailable)}
    >
      {scan?.status ?? 'none'}
    </span>
  ),
  ScanningOffBadge: () => <span data-testid='scanning-off' />,
  showsScanningOff: (scan: { findings: unknown[] } | null | undefined) =>
    !scan || scan.findings.length === 0,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/SecurityScanSwitchesCard',
  () => ({
    SecurityScanSwitchesCard: (props: Record<string, unknown>) => (
      <div data-testid='switches-card' data-props={JSON.stringify(props)} />
    ),
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/ScanEvidenceRetentionRow',
  () => ({
    ScanEvidenceRetentionRow: ({
      initialDays,
    }: {
      initialDays: number | null
    }) => <div data-testid='evidence-row'>{String(initialDays)}</div>,
  })
)

import { PluginSlot, PluginTaskDossier } from '@/lib/plugins/client'

const SCANS = {
  prs: [
    { pr: { id: 'pr1' }, latest: { status: 'FINDINGS', findings: [{}] } },
    { pr: { id: 'pr2' }, latest: null },
  ],
  blocking: { count: 2 },
  scanningOff: false,
}

beforeEach(() => jest.clearAllMocks())

function dossier() {
  let seen: Record<string, unknown> = {}
  render(
    <PluginTaskDossier taskId='t1' isExpanded={() => true} onToggle={jest.fn()}>
      {merged => {
        seen = merged as unknown as Record<string, unknown>
        return (
          <div data-testid='tab'>
            {merged.needsAction}
            {merged.records}
          </div>
        )
      }}
    </PluginTaskDossier>
  )
  return seen
}

describe('task.dossier', () => {
  it('passes the blocking count, the scanned flag, the blocker and the Records row', () => {
    useSecurityScans.mockReturnValue({ data: SCANS, isError: false })
    const merged = dossier()
    expect(merged).toMatchObject({ present: true, blocking: 2, checked: true })
    expect(useSecurityScans).toHaveBeenCalledWith('t1')
    expect(screen.getByTestId('blocking-findings')).toHaveTextContent('t1')
    expect(document.getElementById('dossier-security')).not.toBeNull()
    expect(screen.getByTestId('scan-section')).toHaveTextContent('t1')
  })

  it('no PR: still present (gate says not scanned), no Records row', () => {
    useSecurityScans.mockReturnValue({
      data: { prs: [], blocking: { count: 0 }, scanningOff: false },
      isError: false,
    })
    const merged = dossier()
    expect(merged).toMatchObject({ present: true, blocking: 0, checked: false })
    expect(document.getElementById('dossier-security')).toBeNull()
  })

  it('a failed read keeps the Records row (said out loud inside)', () => {
    useSecurityScans.mockReturnValue({ data: undefined, isError: true })
    const merged = dossier()
    expect(merged).toMatchObject({ blocking: 0, checked: false })
    expect(document.getElementById('dossier-security')).not.toBeNull()
  })
})

describe('task.pullRequest.badge', () => {
  const badge = (pullRequestId: string) =>
    render(
      <PluginSlot
        name='task.pullRequest.badge'
        props={{ taskId: 't1', pullRequestId }}
      />
    )

  it('renders nothing while the read is in flight', () => {
    useSecurityScans.mockReturnValue({ isLoading: true })
    const { container } = badge('pr1')
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the PR's latest scan, or unavailable on a failed read", () => {
    useSecurityScans.mockReturnValue({ data: SCANS, isLoading: false })
    badge('pr1')
    expect(screen.getByTestId('security-scan-badge')).toHaveTextContent(
      'FINDINGS'
    )
    jest.clearAllMocks()
    useSecurityScans.mockReturnValue({ isLoading: false, isError: true })
    badge('pr3')
    const badges = screen.getAllByTestId('security-scan-badge')
    expect(badges[badges.length - 1]!.dataset.unavailable).toBe('true')
  })

  it('a scanning-off workspace shows the scanning-off badge for a PR with nothing open', () => {
    useSecurityScans.mockReturnValue({
      data: { ...SCANS, scanningOff: true },
      isLoading: false,
    })
    badge('pr2')
    expect(screen.getByTestId('scanning-off')).toBeInTheDocument()
  })
})

describe('settings slots', () => {
  it('the switches card reads the stored switches (defaults on) and the platform ceiling', () => {
    const { rerender } = render(
      <PluginSlot
        name='settings.workspace.section'
        props={{ workspace: { id: 'w1' }, me: {} }}
      />
    )
    expect(screen.queryByTestId('switches-card')).toBeNull()
    // A malformed ceiling (missing sandbox) is not drawn as a card either.
    rerender(
      <PluginSlot
        name='settings.workspace.section'
        props={{
          workspace: { id: 'w1' },
          me: { securityPlatform: { hunt: true } },
        }}
      />
    )
    expect(screen.queryByTestId('switches-card')).toBeNull()
    rerender(
      <PluginSlot
        name='settings.workspace.section'
        props={{
          workspace: { id: 'w1', securityHuntEnabled: false },
          me: {
            securityPlatform: { managedScan: true, hunt: true, sandbox: false },
          },
        }}
      />
    )
    expect(
      JSON.parse(screen.getByTestId('switches-card').dataset.props!)
    ).toEqual({
      initial: {
        securityScanEnabled: true,
        securityAiReviewEnabled: true,
        securityHuntEnabled: false,
      },
      huntAvailable: true,
      sandboxAvailable: false,
    })
  })

  it('the evidence row reads scanEvidenceRetentionDays (null when absent)', () => {
    render(
      <>
        <PluginSlot
          name='settings.retention.row'
          props={{ workspace: { id: 'w1', scanEvidenceRetentionDays: 14 } }}
        />
        <PluginSlot
          name='settings.retention.row'
          props={{ workspace: { id: 'w1' } }}
        />
      </>
    )
    expect(
      screen.getAllByTestId('evidence-row').map(e => e.textContent)
    ).toEqual(['14', 'null'])
  })
})

describe('task.crossing.annotation', () => {
  it('shows the triage line only when the crossing has a score', () => {
    const slot = (p: number | null): ReactNode => (
      <PluginSlot
        name='task.crossing.annotation'
        props={{ crossingId: 'c1', triageProbability: p, disposition: null }}
      />
    )
    const { container, rerender } = render(<>{slot(null)}</>)
    expect(container).toBeEmptyDOMElement()
    rerender(<>{slot(0.42)}</>)
    expect(screen.getByTestId('boundary-triage-c1')).toBeInTheDocument()
  })
})
