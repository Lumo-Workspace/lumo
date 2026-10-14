/**
 * @jest-environment node
 *
 * LUM-1099 — the `testcase` commands print member-writable fields that come
 * back from the server (title, setup, steps, verification, expected, run note,
 * actual, failed-step text, reported step text). Each is stripped of terminal
 * control characters before it reaches the terminal, so a test case titled
 * with an ANSI escape cannot repaint the user's screen.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/session-id', () => ({
  resolveSessionId: jest.fn(),
}))
jest.mock('../../src/lib/status-digest', () => ({
  printStatusDigest: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import { taskTestCaseAdd } from '../../src/commands/task-testcase-add'
import { taskTestCaseUpdate } from '../../src/commands/task-testcase-update'
import { taskTestCaseList } from '../../src/commands/task-testcase-list'
import { taskTestCaseShow } from '../../src/commands/task-testcase-show'
import { formatStepResultLines } from '../../src/lib/test-case-steps'

// Built at runtime so no control byte sits in the source file.
const ESC = String.fromCharCode(0x1b)
const CSI8 = String.fromCharCode(0x9b)
const evil = (s: string) => `${ESC}[31m${s}${ESC}[0m${CSI8}2J`

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
const printed = () => logSpy.mock.calls.map(c => String(c[0])).join('\n')

const respond = (body: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('testcase add', () => {
  it('strips control characters from the server-returned title', async () => {
    respond({ testCase: { id: 'c1', number: 3, title: evil('Login works') } })
    await taskTestCaseAdd('LUM-1', {
      title: 'Login works',
      step: ['open'],
      expected: 'ok',
    })
    const out = printed()
    expect(out).toContain('Created LUM-1/TC3 "[31mLogin works[0m2J"')
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
  })
})

describe('testcase update', () => {
  it('strips control characters from the server-returned title', async () => {
    respond({ testCase: { number: 4, title: evil('Renamed') } })
    await taskTestCaseUpdate('LUM-1/TC4', { title: 'Renamed' })
    const out = printed()
    expect(out).toContain('Updated LUM-1/TC4 "[31mRenamed[0m2J"')
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
  })
})

describe('testcase list', () => {
  it('strips control characters from each title', async () => {
    respond({
      testCases: [
        {
          number: 1,
          title: evil('Listed'),
          steps: ['a'],
          verification: [],
          runs: [],
        },
      ],
    })
    await taskTestCaseList('LUM-1')
    const out = printed()
    expect(out).toContain('Listed')
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
  })

  // LUM-1104: sanitizeField keeps \n / \t on purpose, but this list is one
  // tab-separated line per case — a title must not forge a row or a column.
  it('a title with \\n / \\t forges no extra line or column', async () => {
    respond({
      testCases: [
        {
          number: 1,
          title: 'Real\nTC9\tforged\t0 steps / 0 verify\tPASS on LOCAL',
          steps: ['a'],
          verification: [],
          runs: [],
        },
      ],
    })
    await taskTestCaseList('LUM-1')
    const lines = printed().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.split('\t')).toEqual([
      'TC1',
      'Real TC9 forged 0 steps / 0 verify PASS on LOCAL',
      '1 steps / 0 verify',
      'never run',
    ])
  })

  it('control characters in the last-run cell are stripped', async () => {
    respond({
      testCases: [
        {
          number: 3,
          title: 'Ok',
          steps: ['a'],
          verification: [],
          runs: [
            {
              result: 'PASS',
              environment: evil('LOCAL'),
              createdAt: '2026-10-13T12:00:00Z',
              commitSha: null,
              commitDirty: null,
            },
          ],
        },
      ],
    })
    await taskTestCaseList('LUM-1')
    const out = printed()
    expect(out).toContain('PASS on [31mLOCAL[0m2J (2026-10-13)')
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
  })

  it("a runner's name with \\t / \\n stays inside the last-run column", async () => {
    respond({
      testCases: [
        {
          number: 2,
          title: 'Ok',
          steps: ['a'],
          verification: [],
          runs: [
            {
              result: 'PASS',
              environment: 'LOCAL',
              createdAt: '2026-10-13T12:00:00Z',
              commitSha: null,
              commitDirty: null,
              executedBy: 'Ada\tTC3\nLovelace',
              sourceSessionId: null,
            },
          ],
        },
      ],
    })
    await taskTestCaseList('LUM-1')
    const lines = printed().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.split('\t')).toEqual([
      'TC2',
      'Ok',
      '1 steps / 0 verify',
      'PASS on LOCAL (2026-10-13) by Ada TC3 Lovelace',
    ])
  })
})

describe('testcase show', () => {
  it('strips control characters from every member-writable field', async () => {
    respond({
      testCase: {
        number: 2,
        title: evil('Title'),
        setup: evil('Setup'),
        steps: [evil('Step one')],
        verification: [evil('Verify one')],
        expected: evil('Expected'),
      },
      runs: [
        {
          id: 'r1',
          result: 'FAIL',
          environment: 'LOCAL',
          failedPhase: 'STEPS',
          failedIndex: 0,
          failedStepText: evil('Failed at'),
          note: evil('Note'),
          actual: evil('Actual'),
          stepResults: [
            {
              phase: 'STEPS',
              index: 0,
              status: 'FAIL',
              text: evil('Reported'),
            },
          ],
          evidence: [],
          pullRequestId: null,
          commitSha: null,
          commitDirty: null,
          createdAt: '2026-10-12T08:00:00.000Z',
          disposition: null,
        },
      ],
      pullRequests: [],
    })
    await taskTestCaseShow('LUM-1/TC2')
    const out = printed()
    for (const word of [
      'Title',
      'Setup',
      'Step one',
      'Verify one',
      'Expected',
      'Failed at',
      'Note',
      'Actual',
      'Reported',
    ]) {
      expect(out).toContain(word)
    }
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
  })
})

describe('formatStepResultLines', () => {
  it('strips control characters from reported step text', () => {
    const lines = formatStepResultLines([
      { phase: 'STEPS', index: 0, status: 'PASS', text: evil('x') },
    ])
    expect(lines.join('\n')).not.toContain(ESC)
    expect(lines[0]).toContain('[31mx[0m2J')
  })
})
