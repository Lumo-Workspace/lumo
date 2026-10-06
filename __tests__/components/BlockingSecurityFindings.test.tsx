/** @jest-environment jsdom */
/**
 * LUM-1009 — the Record tab's Needs action entries for security: only the
 * findings that block DONE, across every PR, each with its disposition
 * controls. Plus the shared rollup line (`formatSecuritySummaryLine`) the
 * Records row and the scan panel both print.
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
}))

function mockFormat(
  { id }: { id: string },
  values?: Record<string, unknown>
): string {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  let msg = en[id] ?? id
  msg = msg.replace(
    /\{(\w+),\s*plural,\s*(?:=0\s*\{([^}]*)\}\s*)?one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
    (_m, key: string, zero: string | undefined, one: string, other: string) => {
      const n = Number(values?.[key] ?? 0)
      const form = n === 0 && zero !== undefined ? zero : n === 1 ? one : other
      return form.replace('#', String(n))
    }
  )
  for (const [k, v] of Object.entries(values ?? {})) {
    msg = msg.split(`{${k}}`).join(String(v))
  }
  return msg
}

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: mockFormat }),
}))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: { dispositionSecurityFinding: jest.fn().mockResolvedValue({}) },
}))
const useSecurityScans = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { BlockingSecurityFindings } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SecurityScanSection'
import { formatSecuritySummaryLine } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary-line'
import type { IntlShape } from 'react-intl'
import type { TaskSecurityScans } from '@/lib/services/pr-security-scan.service'

const finding = (over: object) => ({
  id: 'f1',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 3,
  title: 'AWS access key ID',
  detail: 'committed',
  evidence: null,
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  inherited: false,
  blocking: true,
  persisting: false,
  queueExit: null,
  suggestedDisposition: null,
  verifierVerdict: null,
  ...over,
})

const prScan = (number: number, findings: object[]) => ({
  pr: {
    id: `pr${number}`,
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'open',
  },
  latest: {
    id: `s${number}`,
    status: 'FINDINGS',
    headSha: 'abcdef1234567',
    complete: true,
    stages: { secrets: 'RAN' },
    findings,
  },
})

beforeEach(() => jest.clearAllMocks())

describe('BlockingSecurityFindings', () => {
  it('lists only blocking findings, across PRs, each with its PR number', () => {
    useSecurityScans.mockReturnValue({
      data: {
        prs: [
          prScan(7, [
            finding({ id: 'b1' }),
            finding({ id: 'nb', blocking: false, severity: 'LOW' }),
          ]),
          prScan(9, [finding({ id: 'b2', title: 'Hard-coded token' })]),
        ],
        blocking: { count: 2 },
        suggested: { count: 0 },
        scanningOff: false,
      },
      isLoading: false,
      isError: false,
    })
    render(<BlockingSecurityFindings taskId='t1' />)

    const box = screen.getByTestId('security-blocking-findings')
    expect(box).toHaveTextContent('2 findings block Done')
    expect(screen.getByTestId('security-finding-b1')).toBeInTheDocument()
    expect(screen.getByTestId('security-finding-b2')).toBeInTheDocument()
    expect(screen.queryByTestId('security-finding-nb')).toBeNull()
    expect(box).toHaveTextContent('#7')
    expect(box).toHaveTextContent('#9')
    // Acted on in place: the disposition controls ride along.
    expect(
      screen.getAllByRole('button', { name: 'Mark false positive' })
    ).toHaveLength(2)
  })

  it('renders nothing when no finding blocks, or before data arrives', () => {
    useSecurityScans.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    const { container, rerender } = render(
      <BlockingSecurityFindings taskId='t1' />
    )
    expect(container).toBeEmptyDOMElement()

    useSecurityScans.mockReturnValue({
      data: {
        prs: [prScan(7, [finding({ blocking: false })])],
        blocking: { count: 0 },
        suggested: { count: 0 },
        scanningOff: false,
      },
      isLoading: false,
      isError: false,
    })
    rerender(<BlockingSecurityFindings taskId='t1' />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('formatSecuritySummaryLine', () => {
  const intl = { formatMessage: mockFormat } as unknown as IntlShape

  it('rolls up PRs and undispositioned findings', () => {
    const data = {
      prs: [prScan(7, [finding({})]), prScan(9, [])],
      blocking: { count: 1 },
      suggested: { count: 0 },
      scanningOff: false,
    } as unknown as TaskSecurityScans
    expect(formatSecuritySummaryLine(intl, data)).toBe('2 PRs · 1 finding')
  })

  it('never says "no findings" outright while a scan is incomplete', () => {
    const data = {
      prs: [
        {
          ...prScan(7, []),
          latest: { ...prScan(7, []).latest, complete: false },
        },
      ],
      blocking: { count: 0 },
      suggested: { count: 0 },
      scanningOff: false,
    } as unknown as TaskSecurityScans
    const line = formatSecuritySummaryLine(intl, data)
    expect(line).toContain('no findings on completed scans')
    expect(line).toContain('not fully checked yet')
  })
})
