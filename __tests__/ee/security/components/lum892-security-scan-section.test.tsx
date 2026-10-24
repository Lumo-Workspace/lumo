/**
 * LUM-892 — the task panel for layers the customer turned off in settings,
 * and for a workspace that turned scanning off altogether. Rendered with the
 * real en.json messages and the real PR badge, so the words asserted are the
 * words a customer reads.
 */
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'

// react-intl ships ESM jest can't load from node_modules. The messages are the
// real en.json ones, run through a small formatter covering what these keys
// use: `{name}` arguments and `{n, plural, one {…} other {…}}` with `#`.
jest.mock('react-intl', () => {
  const en = jest.requireActual('@/lib/i18n/en.json') as Record<string, string>
  const plural = (msg: string, values: Record<string, unknown>): string => {
    const m = /\{(\w+), plural, /.exec(msg)
    if (!m) return msg
    let i = m.index + m[0].length
    const branches: Record<string, string> = {}
    while (msg[i] !== '}') {
      const sel = /^\s*(=?\w+)\s*\{/.exec(msg.slice(i))!
      i += sel[0].length
      let depth = 1
      const start = i
      while (depth > 0) {
        if (msg[i] === '{') depth++
        if (msg[i] === '}') depth--
        i++
      }
      branches[sel[1]!] = msg.slice(start, i - 1)
      while (msg[i] === ' ') i++
    }
    const n = Number(values[m[1]!])
    const body = (branches[`=${n}`] ??
      (n === 1 ? branches.one : undefined) ??
      branches.other)!.replace(/#/g, String(n))
    return plural(msg.slice(0, m.index) + body + msg.slice(i + 1), values)
  }
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values: Record<string, unknown> = {}
      ) =>
        plural(en[id] ?? id, values).replace(/\{(\w+)\}/g, (_m, k: string) =>
          String(values[k] ?? '')
        ),
    }),
  }
})

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: { reviewPullRequest: jest.fn() },
}))
import { tasksClient } from '@/lib/api-client'
const useSecurityScans = jest.fn()
jest.mock('@/ee/security/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/ee/security/components/TaskDetailTimeline/SecurityScanSection'
import { scanCoverageState } from '@/shared/src/security-scan'
import {
  ScanningOffBadge,
  showsScanningOff,
} from '@/ee/security/ui/pr-scan-badge'

const finding = (over: object = {}) => ({
  id: 'f1',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 3,
  title: 'AWS access key ID',
  detail: 'committed',
  evidence: 'const k = "AKIA…(len 20)"',
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  inherited: false,
  blocking: true,
  persisting: false,
  queueExit: null,
  suggestedDisposition: null,
  ...over,
})

// `coverage` / `complete` derived exactly as the server derives them.
const scan = (over: {
  stages: Record<string, string>
  findings?: unknown[]
  ownedUnfinished?: boolean
}) => {
  const base = {
    id: 's1',
    status: (over.findings?.length ?? 0) > 0 ? 'FINDINGS' : 'CLEAN',
    headSha: 'abcdef1234567',
    trigger: 'PR_EVENT',
    judgeStatus: 'SKIPPED',
    truncated: false,
    partial: false,
    externalLate: false,
    error: null,
    startedAt: '2026-09-28T00:00:00Z',
    finishedAt: '2026-09-28T00:01:00Z',
    fixed: 0,
    huntProgress: null,
    huntOverCap: null,
    judgeOverCap: null,
    judgePartial: null,
    findings: [],
    ...over,
  }
  const coverage = scanCoverageState(base)
  return {
    ...base,
    coverage,
    complete: coverage === 'CHECKED',
    ownedUnfinished: coverage === 'UNFINISHED',
  }
}
const PR = {
  id: 'pr1',
  number: 9,
  title: 'feat: add route',
  url: 'https://github.com/o/r/pull/9',
  state: 'open',
}
const TURNED_OFF_STAGES = {
  secrets: 'RAN',
  external: 'RAN',
  judge: 'DISABLED',
  hunt: 'DISABLED',
}

function renderPanel(data: object) {
  useSecurityScans.mockReturnValue({ data, isLoading: false, isError: false })
  return render(<SecurityScanSection taskId='t1' />)
}

beforeEach(() => jest.clearAllMocks())

// jsdom has no PointerEvent, so fireEvent.pointerDown would drop `button`
// and the Radix DropdownMenu trigger (which opens on pointerdown) ignores it.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}

/** LUM-1308: the review actions sit behind the PR header's ⋯ menu. */
async function chooseReviewAction(name: string) {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'Review actions' }),
    {
      button: 0,
      ctrlKey: false,
    }
  )
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

test('LUM-1056 paused head exposes manual review controls and reports request failures', async () => {
  const request = tasksClient.reviewPullRequest as jest.Mock
  request.mockResolvedValueOnce({ queued: true })
  renderPanel({
    prs: [
      {
        pr: { ...PR, repo: 'o/r' },
        latest: scan({
          stages: { secrets: 'RAN', judge: 'PAUSED' },
          ownedUnfinished: false,
        }),
      },
    ],
    blocking: { count: 0 },
    suggested: { count: 0 },
    scanningOff: false,
  })
  await chooseReviewAction('Review changes')
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(9, 'o/r', 'incremental')
  )
  const status = await screen.findByRole('status')
  expect(status).toHaveTextContent('Review requested')
  // A quiet caption next to the menu.
  expect(status).toHaveClass('text-caption', 'text-muted-foreground')
  request.mockRejectedValueOnce(new Error('network'))
  await chooseReviewAction('Resume automatic reviews')
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not update review settings')
  expect(alert).toHaveClass('text-caption', 'text-danger-text')
})

describe('LUM-892 turned-off layer in the task panel', () => {
  const data = (latest: object) => ({
    prs: [{ pr: PR, latest }],
    blocking: { count: 0 },
    suggested: { count: 0 },
    scanningOff: false,
  })

  it('LUM-892 turned-off layer: a clean scan with AI review and hunt off is never shown as Clean', () => {
    renderPanel(data(scan({ stages: TURNED_OFF_STAGES })))
    const badge = screen.getByTestId('security-scan-badge')
    expect(badge).toHaveAttribute('data-state', 'turned-off')
    expect(badge).toHaveTextContent('Some checks off')
    expect(badge).not.toHaveTextContent('Clean')
    // (The Records row's verdict for this case: security-verdict.test.)
  })

  it('LUM-892 turned-off layer: the row says the layers were turned off in settings, not unfinished on our side', () => {
    renderPanel(data(scan({ stages: TURNED_OFF_STAGES })))
    for (const [key, label] of [
      ['judge', 'AI code review: Off in settings'],
      ['hunt', 'Attack paths: Off in settings'],
    ]) {
      const cell = screen.getByTestId(`stage-${key}`)
      expect(within(cell).getByLabelText(label!)).toBeInTheDocument()
      // The customer's choice, not ours unfinished: no warning tone, and
      // the check does not open by itself.
      expect(cell).toHaveAttribute('data-tone', 'off')
      expect(cell.querySelector('.text-warning-text')).toBeNull()
    }
    expect(screen.getByTestId('scan-turned-off')).toHaveTextContent(
      "Turned off in this workspace's settings: AI code review, Attack paths. Those checks did not look at this PR."
    )
    expect(screen.queryByTestId('scan-unfinished')).toBeNull()
  })

  it('LUM-892 turned-off layer: control, the same scan with every layer run reads Clean', () => {
    renderPanel(
      data(
        scan({
          stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        })
      )
    )
    expect(screen.getByTestId('security-scan-badge')).toHaveAttribute(
      'data-state',
      'clean'
    )
  })
})

describe('LUM-892 scanning turned off in the task panel', () => {
  it('LUM-892 scanning turned off: a PR never scanned says scanning is off, not that a scan runs on every push', () => {
    renderPanel({
      prs: [{ pr: PR, latest: null }],
      blocking: { count: 0 },
      suggested: { count: 0 },
      scanningOff: true,
    })
    const panel = screen.getByTestId('security-scan-panel')
    expect(screen.getByTestId('security-scanning-off')).toHaveTextContent(
      "Security scanning is turned off in this workspace's settings, so this task's pull requests aren't scanned."
    )
    expect(panel).not.toHaveTextContent('a scan runs on every push')
  })

  it('LUM-892 scanning turned off: an old clean result is no longer shown as Clean, and old blocking findings still show as blocking', () => {
    renderPanel({
      prs: [
        {
          pr: PR,
          latest: scan({
            stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
          }),
        },
        {
          pr: { ...PR, id: 'pr2', number: 10 },
          latest: scan({
            stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
            findings: [finding()],
          }),
        },
      ],
      blocking: { count: 1 },
      suggested: { count: 0 },
      scanningOff: true,
    })
    expect(screen.getByTestId('security-scanning-off')).toHaveTextContent(
      'their blocking findings still block Done'
    )
    // The blocking finding from before scanning was turned off still gates —
    // and its PR's tab is the one selected first (LUM-1308).
    expect(screen.getByTestId('security-blocking-banner')).toBeInTheDocument()
    const findingsRow = screen.getByTestId('security-pr-10')
    expect(
      within(findingsRow).getByTestId('security-scan-badge')
    ).toHaveAttribute('data-state', 'findings')
    fireEvent.mouseDown(screen.getByTestId('security-pr-9-toggle'), {
      button: 0,
    })
    const cleanRow = screen.getByTestId('security-pr-9')
    const badge = within(cleanRow).getByTestId('security-scan-badge')
    expect(badge).toHaveAttribute('data-state', 'scanning-off')
    expect(badge).not.toHaveTextContent('Clean')
  })
})

describe('LUM-892 scanning turned off badge variant', () => {
  it('LUM-892 scanning turned off: the variant renders in the shared badge frame', () => {
    render(<ScanningOffBadge />)
    const badge = screen.getByTestId('security-scan-badge')
    expect(badge).toHaveAttribute('data-state', 'scanning-off')
    expect(badge).toHaveTextContent('Scanning off')
  })

  it('LUM-892 scanning turned off: only a PR with nothing open is replaced', () => {
    expect(showsScanningOff(null)).toBe(true)
    expect(showsScanningOff(undefined)).toBe(true)
    expect(showsScanningOff({ findings: [] })).toBe(true)
    expect(showsScanningOff({ findings: [finding() as never] })).toBe(false)
  })
})
