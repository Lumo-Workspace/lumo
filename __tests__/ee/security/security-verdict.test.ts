/**
 * LUM-1012 — the Security scan Records row's verdict (`formatSecurityVerdict`):
 * "Clean" only when nothing qualifies it, open findings counted, and every
 * reason a scan cannot back the verdict named in its own clause (ported from
 * the LUM-496 / LUM-832 / LUM-892 summary-line rules).
 */
import type { IntlShape } from 'react-intl'
import type { TaskSecurityScans } from '@/ee/security/services/pr-security-scan.service'
import { formatSecurityVerdict } from '@/ee/security/components/TaskDetailTimeline/security-summary-line'

const en = require('@/lib/i18n/en.json') as Record<string, string>
function format(
  { id }: { id: string },
  values?: Record<string, unknown>
): string {
  let msg = en[id] ?? id
  msg = msg.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
    (_m, key: string, one: string, other: string) => {
      const n = Number(values?.[key] ?? 0)
      return (n === 1 ? one : other).replace('#', String(n))
    }
  )
  for (const [k, v] of Object.entries(values ?? {}))
    msg = msg.split(`{${k}}`).join(String(v))
  return msg
}
const intl = { formatMessage: format } as unknown as IntlShape

const finding = (over: object = {}) => ({
  id: 'f1',
  severity: 'LOW',
  disposition: null,
  persisting: false,
  queueExit: null,
  verifierVerdict: null,
  ...over,
})
const scan = (over: object = {}) => ({
  complete: true,
  coverage: 'COMPLETE',
  ownedUnfinished: false,
  huntOverCap: null,
  judgeOverCap: null,
  judgePartial: null,
  stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
  findings: [],
  ...over,
})
const data = (
  latests: Array<object | null>,
  over: object = {}
): TaskSecurityScans =>
  ({
    prs: latests.map((latest, i) => ({ pr: { id: `pr${i}` }, latest })),
    blocking: { count: 0 },
    suggested: { count: 0 },
    scanningOff: false,
    ...over,
  }) as unknown as TaskSecurityScans

test('every scan finished with nothing open reads "Clean" with no clause', () => {
  expect(formatSecurityVerdict(intl, data([scan(), scan()]))).toEqual({
    text: 'Clean',
    caveats: [],
  })
})

test('counts only findings someone must decide on (not ruled, not on main, in queue, not verifier-rejected)', () => {
  const v = formatSecurityVerdict(
    intl,
    data([
      scan({
        findings: [
          finding({ id: 'a' }),
          finding({ id: 'b', disposition: 'ACCEPTED_RISK' }),
          finding({ id: 'c', persisting: true }),
          finding({ id: 'd', queueExit: 'MERGED' }),
          finding({ id: 'e', verifierVerdict: 'REJECTED' }),
        ],
      }),
    ])
  )
  expect(v.text).toBe('1 open finding')
})

// Review F1 (honesty): an unfinished or missing scan never lets zero read clean.
test('an incomplete or missing scan qualifies zero findings, in the warning tone', () => {
  const v = formatSecurityVerdict(
    intl,
    data([scan(), scan({ complete: false, coverage: 'UNFINISHED' }), null])
  )
  expect(v.text).toBe('No open findings')
  expect(v.caveats).toEqual([
    { text: '2 scans not fully checked yet', tone: 'warning' },
  ])
})

// LUM-832: over the size limit is its own clause, never "not fully checked".
test('a scan over the size limit is named as such', () => {
  const v = formatSecurityVerdict(
    intl,
    data([
      scan({
        complete: false,
        coverage: 'UNFINISHED',
        huntOverCap: { sourceFiles: 151, capFiles: 150 },
      }),
    ])
  )
  expect(v.text).toBe('No open findings')
  expect(v.caveats).toEqual([
    { text: '1 scan over the size limit', tone: 'warning' },
  ])
})

// LUM-892: checks turned off in settings are the customer's choice — muted.
test('checks turned off qualify the verdict without the warning tone', () => {
  const v = formatSecurityVerdict(
    intl,
    data([scan({ complete: false, coverage: 'TURNED_OFF' })])
  )
  expect(v.text).toBe('No open findings')
  expect(v.caveats).toEqual([
    { text: '1 scan with checks turned off in settings', tone: 'muted' },
  ])
})

test('scanning switched off workspace-wide never reads Clean', () => {
  const v = formatSecurityVerdict(intl, data([scan()], { scanningOff: true }))
  expect(v.text).toBe('No open findings')
  expect(v.caveats).toEqual([{ text: 'Scanning off', tone: 'muted' }])
})

test('open findings are counted even while a scan is incomplete', () => {
  const v = formatSecurityVerdict(
    intl,
    data([
      scan({ findings: [finding(), finding({ id: 'b' })] }),
      scan({ complete: false, coverage: 'UNFINISHED' }),
    ])
  )
  expect(v.text).toBe('2 open findings')
  expect(v.caveats).toHaveLength(1)
})

// LUM-1298: a warned or failed pre-merge check (LUM-702: Issue assessment,
// one goal not addressed) never lets the row read a bare "Clean".
test('a non-passing pre-merge check qualifies the verdict in the warning tone', () => {
  const check = (verdict: string) => ({
    id: `c-${verdict}`,
    name: 'Issue assessment',
    mode: 'warning',
    verdict,
    explanation: '1 linked requirement: 1 not addressed.',
    resolution: null,
  })
  const v = formatSecurityVerdict(
    intl,
    data([
      scan({ preMergeChecks: [check('failed'), check('passed')] }),
      scan({ preMergeChecks: [check('not_applicable')] }),
    ])
  )
  expect(v.text).toBe('No open findings')
  expect(v.caveats).toEqual([
    { text: '1 pre-merge check not passed', tone: 'warning' },
  ])
})
