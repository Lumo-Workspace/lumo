// LUM-739: the delivery panel's stage summary names the hunt layer when it
// is not RAN / SKIPPED, with its translated label.
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const messages: Record<string, string> = {
  'securityScan.section.title': 'Lumo review',
  'securityScan.meta': 'Scanned {sha}',
  'securityScan.stage.secrets': 'Secrets',
  'securityScan.stage.external': 'Code scan',
  'securityScan.stage.supplyChain': 'Dependencies',
  'securityScan.stage.judge': 'AI review',
  'securityScan.stage.hunt': 'Exploit paths',
  'securityScan.stageState.FAILED': 'failed',
  'securityScan.stageState.NOT_CONFIGURED': 'not configured',
  'securityScan.stageState.PARTIAL': 'partial',
  'securityScan.stageState.PENDING': 'scanning',
  'securityScan.stageState.RAN': 'checked',
  'securityScan.stageState.SKIPPED': 'skipped',
  'lumoReview.check.secrets': 'Leaked secrets',
  'lumoReview.check.supplyChain': 'Vulnerable packages',
  'lumoReview.check.hunt': 'Attack paths',
  'lumoReview.result.scanning': 'Scanning',
  'lumoReview.result.didntFinish': "Didn't finish",
  'lumoReview.result.notNeeded': 'Not needed',
  'securityScan.partial':
    'Some results were cut off at the scan budget — the scan is not complete.',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (messages[id] ?? id).replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(values?.[k] ?? '')
      ),
  }),
}))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/ee/security/api-client', () => ({
  securityScanClient: { dispositionSecurityFinding: jest.fn() },
}))
jest.mock('@/ee/security/ui/pr-scan-badge', () => ({
  SecurityScanBadge: () => <span data-testid='security-scan-badge' />,
}))
const useSecurityScans = jest.fn()
jest.mock('@/ee/security/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/ee/security/components/TaskDetailTimeline/SecurityScanSection'

const pr = {
  id: 'pr1',
  number: 9,
  title: 'feat',
  url: 'https://github.com/o/r/pull/9',
  state: 'open',
}
const scan = (stages: Record<string, string>, complete: boolean) => ({
  id: 's1',
  status: 'CLEAN',
  headSha: 'abcdef1234567',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  stages,
  partial: false,
  complete,
  externalLate: false,
  error: null,
  startedAt: '2026-09-10T00:00:00Z',
  finishedAt: null,
  findings: [],
})
const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>

function renderWith(stages: Record<string, string>, complete: boolean) {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [{ pr, latest: scan(stages, complete) }],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
}

describe('LUM-739 hunt stage', () => {
  test('a PENDING hunt shows "Attack paths: Scanning" after the other layers', () => {
    renderWith(
      { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'PENDING' },
      false
    )
    expect(screen.getByLabelText('Attack paths: Scanning')).toBeInTheDocument()
    expect(screen.getByTestId('stage-hunt')).toHaveAttribute(
      'data-tone',
      'pending'
    )
  })

  test('LUM-763: a FAILED dependency scan is named in the panel, not silently dropped', () => {
    renderWith(
      { secrets: 'RAN', external: 'RAN', supplyChain: 'FAILED', judge: 'RAN' },
      false
    )
    expect(
      screen.getByLabelText("Vulnerable packages: Didn't finish")
    ).toBeInTheDocument()
    expect(screen.getByTestId('stage-supplyChain')).toHaveAttribute(
      'data-tone',
      'warn'
    )
  })

  test('a RAN or SKIPPED hunt gets its cell without the warning tone', () => {
    // LUM-740/1308: every layer has a row; only an incomplete one warns.
    renderWith(
      { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'SKIPPED' },
      true
    )
    const hunt = screen.getByTestId('stage-hunt')
    expect(
      screen.getByLabelText('Attack paths: Not needed')
    ).toBeInTheDocument()
    expect(hunt.querySelector('.text-warning-text')).toBeNull()
    expect(
      screen.getByTestId('stage-secrets').querySelector('.text-warning-text')
    ).toBeNull()
  })
})
