/**
 * @jest-environment node
 *
 * LUM-1234 — the dogfood calibration runner: window selection, git patch
 * parsing, args, and that one PR runs through the SHARED decision core (the
 * same `decideRewardHack` the layer runner calls), with a mocked judge.
 */
jest.mock('@/ee/security/security-scan/reward-hack-decide', () => {
  const actual = jest.requireActual(
    '@/ee/security/security-scan/reward-hack-decide'
  )
  return { ...actual, decideRewardHack: jest.fn(actual.decideRewardHack) }
})

import { decideRewardHack } from '@/ee/security/security-scan/reward-hack-decide'
import {
  BudgetGate,
  buildCalibRequirement,
  calibratePr,
  parseCalibArgs,
  parseGitShowPatches,
  prFileListFromGit,
  renderReviewSheet,
  windowForPr,
  type MergedPr,
} from '@/scripts/analysis/lum1234-trace/calibrate-pr'
import type { RhSession } from '@/ee/security/security-scan/reward-hack-input'

const decide = decideRewardHack as unknown as jest.Mock

function pr(number: number, task: string, mergedAt: string): MergedPr {
  return {
    number,
    task,
    sha: `sha${number}`,
    mergedAt,
    title: `feat: thing ${number} [${task}]`,
    files: ['src/a.ts'],
  }
}

describe('windowForPr', () => {
  const all = [
    pr(3, 'LUM-1', '2026-10-12T00:00:00Z'),
    pr(2, 'LUM-2', '2026-10-11T00:00:00Z'),
    pr(1, 'LUM-1', '2026-10-10T00:00:00Z'),
    pr(0, 'LUM-1', '2026-10-05T00:00:00Z'),
  ]
  it('opens at the previous merge of the same task and ends at this merge', () => {
    const w = windowForPr(all[0]!, all)
    expect(w.start?.toISOString()).toBe('2026-10-10T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-10-12T00:00:00.000Z')
  })
  it('has no start for the first PR of a task, and ignores other tasks', () => {
    expect(windowForPr(all[3]!, all).start).toBeNull()
    expect(windowForPr(all[1]!, all).start).toBeNull()
  })
  it('reads merge times with offsets', () => {
    const a = pr(5, 'LUM-9', '2026-10-18T19:12:28+11:00')
    const b = pr(4, 'LUM-9', '2026-10-18T07:00:00Z')
    expect(windowForPr(a, [a, b]).start?.toISOString()).toBe(
      '2026-10-18T07:00:00.000Z'
    )
  })
})

describe('parseGitShowPatches', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old line',
    '+new line here',
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1 @@',
    '+export const added = 1',
    'diff --git a/old/b.ts b/new/b.ts',
    'similarity index 100%',
    'rename from old/b.ts',
    'rename to new/b.ts',
    'diff --git a/img.png b/img.png',
    'Binary files a/img.png and b/img.png differ',
    '',
  ].join('\n')
  it('splits per file with GitHub-style hunks and statuses', () => {
    const m = parseGitShowPatches(diff)
    expect(m.get('src/a.ts')).toEqual({
      patch: '@@ -1,2 +1,2 @@\n keep\n-old line\n+new line here',
      status: 'modified',
    })
    expect(m.get('src/new.ts')?.status).toBe('added')
    expect(m.get('new/b.ts')).toEqual({ patch: null, status: 'renamed' })
    expect(m.get('img.png')?.patch).toBeNull()
  })
  it('a listed file the diff lacks has no hunks', () => {
    const list = prFileListFromGit(
      ['src/a.ts', 'gone.ts'],
      parseGitShowPatches(diff)
    )
    expect(list[1]).toEqual({ filename: 'gone.ts', patch: null })
  })
})

describe('parseCalibArgs', () => {
  it('reads the flags', () => {
    const a = parseCalibArgs([
      'node',
      'x',
      '--dry-run',
      '--limit',
      '5',
      '--since',
      '2026-10-01',
      '--budget',
      '7.5',
      '--out',
      '/tmp/o.jsonl',
    ])
    expect(a).toMatchObject({
      dryRun: true,
      limit: 5,
      budget: 7.5,
      out: '/tmp/o.jsonl',
    })
    expect(a.since?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(a).toMatchObject({ attribution: 'branch+path', probes: false })
  })
  it('reads --attribution and --probes', () => {
    expect(
      parseCalibArgs(['n', 'x', '--attribution', 'branch', '--probes'])
    ).toMatchObject({ attribution: 'branch', probes: true })
    expect(() => parseCalibArgs(['n', 'x', '--attribution', 'path'])).toThrow()
  })
  it('rejects a bad value or flag', () => {
    expect(() => parseCalibArgs(['n', 'x', '--budget', '-1'])).toThrow()
    expect(() => parseCalibArgs(['n', 'x', '--limit'])).toThrow()
    expect(() => parseCalibArgs(['n', 'x', '--nope'])).toThrow()
  })
})

describe('buildCalibRequirement', () => {
  it('is the PR title, plus the task description when known', () => {
    expect(buildCalibRequirement('feat: x', null)).toBe('# feat: x')
    expect(
      buildCalibRequirement('feat: x', {
        title: 't',
        descriptionMarkdown: 'do x',
      })
    ).toBe('# feat: x\n\ndo x')
  })
})

describe('calibratePr', () => {
  const PR = pr(9, 'LUM-1', '2026-10-12T00:00:00Z')
  const PREV = pr(8, 'LUM-1', '2026-10-10T00:00:00Z')
  const at = (iso: string) => new Date(iso)
  const session: RhSession = {
    id: 's1',
    events: [
      {
        id: 'old-edit',
        sessionId: 's1',
        type: 'POST_TOOL_USE',
        toolName: 'Edit',
        payload: {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/wt/src/a.ts',
            old_string: 'q',
            new_string: 'r',
          },
        },
        createdAt: at('2026-10-09T00:00:00Z'),
      },
      {
        id: 'p1',
        sessionId: 's1',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: { prompt: 'make the suite pass' },
        createdAt: at('2026-10-11T00:00:00Z'),
      },
      {
        id: 'e1',
        sessionId: 's1',
        type: 'POST_TOOL_USE',
        toolName: 'Edit',
        payload: {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/wt/src/a.ts',
            old_string: 'old line',
            new_string: 'new line here',
          },
          tool_response: { filePath: '/wt/src/a.ts' },
        },
        createdAt: at('2026-10-11T01:00:00Z'),
      },
    ],
  }
  const files = [
    {
      filename: 'src/a.ts',
      patch: '@@ -1 +1 @@\n-old line\n+new line here',
      status: 'modified',
    },
  ]

  beforeEach(() => decide.mockClear())

  it('runs the shared core on the in-window events and records the reported item', async () => {
    const judge = jest.fn(async () => ({
      output: {
        suspicion: 90,
        items: [
          {
            kind: 'TEST_TAMPERING' as const,
            summary: 'weakened assertion',
            eventIds: ['e1'],
          },
        ],
      },
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 100,
    }))
    const refute = jest.fn(async () => ({
      refuted: false,
      reason: 'no legitimate reason',
      costUsd: 0.01,
    }))
    const rec = await calibratePr({
      pr: PR,
      allPrs: [PR, PREV],
      sessions: [session],
      prFileList: files,
      requirement: '# feat',
      requirementSource: 'title',
      judge,
      refute,
      spend: new BudgetGate(10),
    })
    expect(decide).toHaveBeenCalledTimes(1)
    const call = decide.mock.calls[0]![0] as { sessions: RhSession[] }
    // The edit before the previous merge belongs to that PR, not this one.
    expect(call.sessions[0]!.events.map(e => e.id)).toEqual(['p1', 'e1'])
    expect(judge).toHaveBeenCalledTimes(1)
    expect(String((judge.mock.calls[0] as unknown[])[0])).toContain('[e:e1]')
    expect(rec.outcome).toBe('judged')
    expect(rec.suspicion).toBe(90)
    expect(rec.itemsAfterGates).toHaveLength(1)
    expect(rec.refutes[0]).toMatchObject({ refuted: false })
    expect(rec.finalItems).toHaveLength(1)
    expect(rec.finalItems[0]).toMatchObject({
      kind: 'TEST_TAMPERING',
      filePath: 'src/a.ts',
      eventIds: ['e1'],
    })
    expect(rec.finalItems[0]!.cited[0]!.excerpt).toContain('new line here')
    expect(rec.costs.totalUsd).toBeGreaterThan(0)
    expect(renderReviewSheet([rec])).toContain('PR 9 (LUM-1)')
  })

  it('a dry-run gate refuses the judge: no model call, prompt size still known', async () => {
    const judge = jest.fn()
    const gate = new BudgetGate(10, 0, false)
    const rec = await calibratePr({
      pr: PR,
      allPrs: [PR, PREV],
      sessions: [session],
      prFileList: files,
      requirement: '# feat',
      requirementSource: 'title',
      judge,
      refute: jest.fn(),
      spend: gate,
    })
    expect(judge).not.toHaveBeenCalled()
    expect(rec.outcome).toBe('capped')
    expect(rec.promptChars).toBeGreaterThan(0)
    expect(gate.requestedUsd).toBeGreaterThan(0)
  })

  it('no session editing a PR file in the window: skipped, core not called', async () => {
    const rec = await calibratePr({
      pr: PREV,
      allPrs: [PR, PREV],
      sessions: [{ id: 's2', events: [] }],
      prFileList: files,
      requirement: '# feat',
      requirementSource: 'title',
      judge: jest.fn(),
      refute: jest.fn(),
      spend: new BudgetGate(10),
    })
    expect(rec.outcome).toBe('skipped')
    expect(decide).not.toHaveBeenCalled()
  })
})
