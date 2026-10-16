/**
 * @jest-environment node
 *
 * LUM-1185 follow-up — `testcase show` lists evidence under the step it is
 * attached to (server `stepReport.rows[].evidence`, same as web
 * TestCaseRunReport); the rest stays at the end of the run. `--download <dir>`
 * saves the Lumo-hosted evidence with the CLI's API key.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('@/cli/src/lib/resolve', () => ({
  ...jest.requireActual('@/cli/src/lib/resolve'),
  resolveMilestoneId: jest.fn(async () => ({ id: 'm1', name: 'M' })),
}))

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readCredentials } from '@/cli/src/lib/config'
import {
  formatRunLines,
  taskTestCaseShow,
} from '@/cli/src/commands/task-testcase-show'
import { milestoneTestCaseShow } from '@/cli/src/commands/milestone-testcase'
import {
  formatStepReportLines,
  stepEvidenceIndices,
} from '@/cli/src/lib/test-case-report'
import {
  formatEvidenceLines,
  indexedEvidence,
  selectEvidence,
} from '@/cli/src/lib/test-case-evidence'
import {
  classifyEvidence,
  downloadRunsEvidence,
  runDirName,
  sanitizeEvidenceFilename,
  uniqueFilename,
} from '@/cli/src/lib/test-case-download'
import { deriveStepReport } from '@/lib/test-cases/step-report'

/** Built at runtime so no credential-shaped literal sits in the source. */
const TOKEN = ['fixture', 'bearer', 'value'].join('-')
const BASE = 'https://lumo.example'
const ESC = String.fromCharCode(27)

const tc = {
  number: 3,
  title: 'Refund to card',
  setup: null,
  steps: ['open the invoice', 'click Refund'],
  verification: ['banner says Refunded'],
  expected: 'Refund lands on the card.',
}

const file = (name: string, id: string, origin = BASE) => ({
  type: 'file',
  url: `${origin}/api/files/test-evidence/t1/c1/${id}`,
  filename: name,
  contentType: 'image/png',
  size: 4,
})

const step = (
  phase: 'STEPS' | 'VERIFICATION',
  index: number,
  evidence: number[] = []
) => ({
  phase,
  index,
  text: (phase === 'STEPS' ? tc.steps : tc.verification)[index],
  status: 'PASS',
  reason: null,
  durationMs: null,
  evidence,
})

function wireRun(over: Record<string, unknown> = {}) {
  const run = {
    id: 'cmrun0000abcdefgh',
    result: 'PASS' as const,
    environment: 'LOCAL',
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    failureAttribution: null,
    unprovenVerification: [],
    evidence: [] as unknown,
    stepResults: [] as unknown,
    disposition: null,
    note: null,
    actual: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    createdAt: '2026-10-17T08:00:00.000Z',
    executedBy: 'Ada',
    sourceSessionId: null,
    ...over,
  }
  return {
    ...run,
    // Same pure function the server's runVerdictOf calls.
    stepReport: deriveStepReport(tc, run as never),
    review: null,
  }
}

const mixed = () =>
  wireRun({
    evidence: [
      file('invoice.png', 'f1'),
      { type: 'link', url: 'https://ci.example.com/7', label: 'CI run' },
      file('banner.png', 'f3'),
    ],
    stepResults: [
      step('STEPS', 0, [0]),
      step('STEPS', 1),
      step('VERIFICATION', 0, [2]),
    ],
  })

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
const printed = () => logSpy.mock.calls.map(c => String(c[0])).join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: TOKEN,
    apiUrl: BASE,
    workspaceSlug: 'lumo',
  })
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('show — evidence under its step', () => {
  it('lists step evidence under the step row and the rest at the end (mixed)', () => {
    const lines = formatRunLines(mixed() as never, [])
    const at = (needle: string) => lines.findIndex(l => l.includes(needle))

    const s1 = at('step 1: open the invoice')
    expect(lines[s1 + 1]).toBe(
      `        invoice.png  ${BASE}/api/files/test-evidence/t1/c1/f1`
    )
    const v1 = at('verification 1: banner says Refunded')
    expect(lines[v1 + 1]).toBe(
      `        banner.png  ${BASE}/api/files/test-evidence/t1/c1/f3`
    )
    // Run-level evidence keeps the old 6-space indent at the end, once each.
    expect(lines[lines.length - 1]).toBe(
      '      CI run  https://ci.example.com/7'
    )
    expect(lines.filter(l => l.includes('invoice.png'))).toHaveLength(1)
    expect(lines.filter(l => l.includes('banner.png'))).toHaveLength(1)
  })

  it('only step evidence: nothing is printed after the step rows', () => {
    const run = wireRun({
      evidence: [file('a.png', 'f1')],
      stepResults: [
        step('STEPS', 0, [0]),
        step('STEPS', 1),
        step('VERIFICATION', 0),
      ],
    })
    const lines = formatRunLines(run as never, [])
    expect(lines.filter(l => l.includes('a.png'))).toEqual([
      `        a.png  ${BASE}/api/files/test-evidence/t1/c1/f1`,
    ])
    expect(lines[lines.length - 1]).toContain('verification 1')
  })

  it('only run-level evidence: everything stays at the end of the run', () => {
    const run = wireRun({
      evidence: [file('a.png', 'f1'), file('b.png', 'f2')],
      stepResults: [
        step('STEPS', 0),
        step('STEPS', 1),
        step('VERIFICATION', 0),
      ],
    })
    const lines = formatRunLines(run as never, [])
    expect(lines.slice(-2)).toEqual([
      `      a.png  ${BASE}/api/files/test-evidence/t1/c1/f1`,
      `      b.png  ${BASE}/api/files/test-evidence/t1/c1/f2`,
    ])
  })

  it('keeps raw indices when a malformed entry sits before step evidence', () => {
    const run = wireRun({
      evidence: ['junk', file('second.png', 'f2')],
      stepResults: [
        step('STEPS', 0, [1]),
        step('STEPS', 1),
        step('VERIFICATION', 0),
      ],
    })
    const lines = formatRunLines(run as never, [])
    const s1 = lines.findIndex(l => l.includes('step 1:'))
    expect(lines[s1 + 1]).toContain('second.png')
  })

  it('an old server without stepReport prints all evidence at the end', () => {
    const run = { ...mixed(), stepReport: undefined }
    const lines = formatRunLines(run as never, [])
    expect(lines.slice(-3).map(l => l.trim().split('  ')[0])).toEqual([
      'invoice.png',
      'CI run',
      'banner.png',
    ])
  })

  it('formatStepReportLines without evidence keeps the old shape; stepEvidenceIndices dedupes', () => {
    const run = mixed()
    expect(formatStepReportLines(run.stepReport)).toHaveLength(3)
    expect(
      stepEvidenceIndices({
        ...run.stepReport,
        rows: [
          { ...run.stepReport.rows[0], evidence: [0, 0, -1, 'x'] },
          run.stepReport.rows[2],
        ],
      })
    ).toEqual([0, 2])
    expect(stepEvidenceIndices(undefined)).toEqual([])
  })

  it('indexedEvidence / selectEvidence / formatEvidenceLines filter by raw index', () => {
    const ev = ['junk', file('a.png', 'f1'), file('b.png', 'f2')]
    expect(indexedEvidence(ev).map(e => e.rawIndex)).toEqual([1, 2])
    expect(selectEvidence(ev, { only: [2] }).map(e => e.rawIndex)).toEqual([2])
    expect(selectEvidence(ev, { exclude: [1] }).map(e => e.rawIndex)).toEqual([
      2,
    ])
    expect(formatEvidenceLines(ev, '  ', { only: [1] })).toEqual([
      `  a.png  ${BASE}/api/files/test-evidence/t1/c1/f1`,
    ])
  })

  it('the show command prints step evidence under its step end to end', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ testCase: tc, runs: [mixed()], pullRequests: [] }),
    }) as never
    await taskTestCaseShow('LUM-42/TC3')
    expect(printed()).toMatch(
      /step 1: open the invoice\n {8}invoice\.png {2}https:\/\/lumo\.example\/api\/files\/test-evidence\/t1\/c1\/f1/
    )
  })
})

describe('download helpers', () => {
  it('sanitizes path traversal, separators and control characters', () => {
    expect(sanitizeEvidenceFilename('../../etc/passwd')).toBe('_._etc_passwd')
    expect(sanitizeEvidenceFilename('..')).toBe('evidence')
    expect(sanitizeEvidenceFilename('a\\b/c.png')).toBe('a_b_c.png')
    expect(sanitizeEvidenceFilename(`x${ESC}[31my.png`)).not.toContain(ESC)
    expect(sanitizeEvidenceFilename('.hidden')).toBe('hidden')
    expect(sanitizeEvidenceFilename('')).toBe('evidence')
    const long = sanitizeEvidenceFilename(`${'a'.repeat(300)}.png`)
    expect(long.length).toBeLessThanOrEqual(180)
    expect(long.endsWith('.png')).toBe(true)
    for (const name of ['../x', '..\\..\\x', '/abs/path', 'a/../../b'])
      expect(sanitizeEvidenceFilename(name)).not.toMatch(/[/\\]|\.\./)
  })

  it('numbers duplicate names and avoids files already on disk', () => {
    const taken = new Set<string>()
    const onDisk = new Set(['SHOT-2.png'])
    const exists = (n: string) => onDisk.has(n)
    expect(uniqueFilename('shot.png', taken, exists)).toBe('shot.png')
    expect(uniqueFilename('SHOT.png', taken, exists)).toBe('SHOT-3.png')
    expect(uniqueFilename('noext', taken, exists)).toBe('noext')
    expect(uniqueFilename('noext', taken, exists)).toBe('noext-2')
  })

  it('names the run directory by day, result and id tail', () => {
    expect(
      runDirName({
        id: 'cmrun0000abcdefgh',
        result: 'FAIL',
        createdAt: '2026-10-17T08:00:00.000Z',
        evidence: [],
      })
    ).toMatch(/^2026-10-1[67]-fail-abcdefgh$/)
  })

  it('classifies hosted files vs external links and always targets the API origin', () => {
    const c = (entry: unknown) =>
      classifyEvidence(indexedEvidence([entry])[0]!, BASE)
    // File on a preview origin: still Lumo-hosted, path only, query dropped.
    expect(
      c({
        ...file('a.png', 'f1', 'https://preview.example'),
        url: 'https://preview.example/api/files/test-evidence/t/c/f1?share=x',
      })
    ).toEqual({
      kind: 'download',
      path: '/api/files/test-evidence/t/c/f1',
      filename: 'a.png',
      label: 'a.png',
    })
    // A link to some other host is external even under /api/files/.
    expect(
      c({ type: 'link', url: 'https://evil.example/api/files/x/y/z' }).kind
    ).toBe('external')
    expect(c({ type: 'link', url: 'https://ci.example.com/7' }).kind).toBe(
      'external'
    )
    // Legacy public blob file: not under /api/files → external.
    expect(c(file('a.png', 'x', 'https://blob.example')).kind).toBe('download')
    expect(
      c({ ...file('a.png', 'x'), url: 'https://blob.example/test-evidence/a' })
        .kind
    ).toBe('external')
    // A same-origin link to a hosted file downloads, named by its last segment.
    expect(
      c({ type: 'link', url: `${BASE}/api/files/test-evidence/t/c/f9` })
    ).toMatchObject({ kind: 'download', filename: 'f9' })
  })
})

describe('downloadRunsEvidence', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lum1185-dl-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const ctx = { base: BASE, token: TOKEN, workspaceSlug: 'lumo' }
  const bytes = (s: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(s).buffer,
  })

  it('sends the API key to the API origin only, never prints it, and saves files', async () => {
    const fetchMock = jest.fn().mockResolvedValue(bytes('PNG1'))
    const out: string[] = []
    const target = path.join(dir, 'nested', 'out')
    const ok = await downloadRunsEvidence(
      ctx,
      [
        {
          id: 'cmrun0000abcdefgh',
          result: 'PASS',
          createdAt: '2026-10-17T08:00:00.000Z',
          evidence: [
            file('../../evil.png', 'f1', 'https://preview.example'),
            file('../../evil.png', 'f2'),
            { type: 'link', url: 'https://ci.example.com/7', label: 'CI run' },
          ],
        },
      ],
      target,
      { fetch: fetchMock as never, print: l => out.push(l) }
    )

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url).startsWith(`${BASE}/api/files/`)).toBe(true)
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
      expect(init.redirect).toBe('manual')
    }
    const text = out.join('\n')
    expect(text).not.toContain(TOKEN)
    expect(text).toContain(
      'CI run  https://ci.example.com/7  (external link, not downloaded)'
    )

    const runDir = path.join(target, fs.readdirSync(target)[0]!)
    expect(fs.readdirSync(runDir).sort()).toEqual([
      '_._evil-2.png',
      '_._evil.png',
    ])
    expect(fs.readFileSync(path.join(runDir, '_._evil.png'), 'utf8')).toBe(
      'PNG1'
    )
    // Nothing escaped the target directory.
    expect(fs.readdirSync(dir)).toEqual(['nested'])
    expect(out.filter(l => l.startsWith('  saved '))).toHaveLength(2)
  })

  it('a single failure prints one ✗ line, continues, and reports not-all-ok', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(bytes('OK'))
    const out: string[] = []
    const ok = await downloadRunsEvidence(
      ctx,
      [
        {
          id: 'r-aaaaaaaa',
          result: 'FAIL',
          createdAt: '2026-10-17T08:00:00.000Z',
          evidence: [file('gone.png', 'f1'), file('there.png', 'f2')],
        },
      ],
      dir,
      { fetch: fetchMock as never, print: l => out.push(l) }
    )
    expect(ok).toBe(false)
    expect(out).toContain('  ✗ gone.png: HTTP 404')
    expect(
      out.some(l => l.startsWith('  saved ') && l.endsWith('there.png'))
    ).toBe(true)
  })

  it('a network error is a ✗ line too, without the key', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const out: string[] = []
    const ok = await downloadRunsEvidence(
      ctx,
      [
        {
          id: 'r-aaaaaaaa',
          result: 'PASS',
          createdAt: '2026-10-17T08:00:00.000Z',
          evidence: [file('a.png', 'f1')],
        },
      ],
      dir,
      { fetch: fetchMock as never, print: l => out.push(l) }
    )
    expect(ok).toBe(false)
    expect(out.join('\n')).toContain('✗ a.png: could not reach')
    expect(out.join('\n')).not.toContain(TOKEN)
  })

  it('splits runs into per-run subdirectories and says when nothing is there', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => bytes('x'))
    const out: string[] = []
    await downloadRunsEvidence(
      ctx,
      [
        {
          id: 'r-11111111',
          result: 'PASS',
          createdAt: '2026-10-17T08:00:00.000Z',
          evidence: [file('a.png', 'f1')],
        },
        {
          id: 'r-22222222',
          result: 'FAIL',
          createdAt: '2026-10-16T08:00:00.000Z',
          evidence: [file('a.png', 'f2')],
        },
      ],
      dir,
      { fetch: fetchMock as never, print: l => out.push(l) }
    )
    expect(fs.readdirSync(dir)).toHaveLength(2)

    const empty: string[] = []
    expect(
      await downloadRunsEvidence(
        ctx,
        [
          {
            id: 'r',
            result: 'PASS',
            createdAt: '2026-10-17T08:00:00.000Z',
            evidence: [],
          },
        ],
        dir,
        {
          fetch: fetchMock as never,
          print: l => empty.push(l),
        }
      )
    ).toBe(true)
    expect(empty).toContain('  no evidence to download')
  })

  it('show --download exits 1 when a file fails and 0 when all succeed (task + milestone)', async () => {
    const showBody = { testCase: tc, runs: [mixed()], pullRequests: [] }
    const json = { ok: true, status: 200, json: async () => showBody }

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(json)
      .mockResolvedValueOnce(bytes('1'))
      .mockResolvedValueOnce({ ok: false, status: 500 }) as never
    expect(await taskTestCaseShow('LUM-42/TC3', { download: dir })).toBe(1)
    expect(printed()).toContain('✗ banner.png: HTTP 500')
    expect(printed()).not.toContain(TOKEN)

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/files/')) return bytes('2')
      expect(url).toBe(`${BASE}/api/milestones/m1/test-cases/TC3`)
      return json
    }) as never
    const code = await milestoneTestCaseShow('M', 'TC3', {
      download: path.join(dir, 'ms'),
    })
    expect(code).toBeUndefined()
    const runDir = path.join(
      dir,
      'ms',
      fs.readdirSync(path.join(dir, 'ms'))[0]!
    )
    expect(fs.readdirSync(runDir).sort()).toEqual(['banner.png', 'invoice.png'])
  })

  it('rejects an empty --download directory', async () => {
    expect(await taskTestCaseShow('LUM-42/TC3', { download: ' ' })).toBe(1)
  })
})
