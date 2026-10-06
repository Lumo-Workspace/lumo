// LUM-739: the delivery panel's stage summary names the hunt layer when it
// is not RAN / SKIPPED, with its translated label.
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const messages: Record<string, string> = {
  'securityScan.section.title': 'Security scan',
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
jest.mock('@/lib/api-client', () => ({
  tasksClient: { dispositionSecurityFinding: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/pr-helpers', () => ({
  SecurityScanBadge: () => <span data-testid='security-scan-badge' />,
}))
const useSecurityScans = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SecurityScanSection'

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
  test('a PENDING hunt shows "Exploit paths: scanning" after the other layers', () => {
    renderWith(
      { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'PENDING' },
      false
    )
    expect(screen.getByTestId('stage-hunt')).toHaveAttribute(
      'aria-label',
      'Exploit paths: scanning'
    )
  })

  test('LUM-763: a FAILED dependency scan is named in the panel, not silently dropped', () => {
    renderWith(
      { secrets: 'RAN', external: 'RAN', supplyChain: 'FAILED', judge: 'RAN' },
      false
    )
    expect(screen.getByTestId('stage-supplyChain')).toHaveAttribute(
      'aria-label',
      'Dependencies: failed'
    )
  })

  test('a RAN or SKIPPED hunt gets its cell without the warning tone', () => {
    // LUM-740/1012: every layer has a cell; only an incomplete one warns. The
    // cells sit on the PR row itself, visible while the row is collapsed.
    renderWith(
      { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'SKIPPED' },
      true
    )
    const hunt = screen.getByTestId('stage-hunt')
    expect(hunt).toHaveAttribute('aria-label', 'Exploit paths: skipped')
    expect(hunt.querySelector('.text-warning-text')).toBeNull()
    expect(
      screen.getByTestId('stage-secrets').querySelector('.text-warning-text')
    ).toBeNull()
  })
})
