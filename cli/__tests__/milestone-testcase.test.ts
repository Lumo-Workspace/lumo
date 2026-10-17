/**
 * @jest-environment node
 */
jest.mock('../src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('../src/lib/session-id', () => ({ resolveSessionId: jest.fn() }))
jest.mock('../src/lib/status-digest', () => ({ printStatusDigest: jest.fn() }))

import { readCredentials } from '../src/lib/config'
import { printStatusDigest } from '../src/lib/status-digest'
import {
  milestoneTestCaseAdd,
  milestoneTestCaseDisposition,
  milestoneTestCaseRm,
  milestoneTestCaseRun,
  milestoneTestCaseShow,
  milestoneTestCaseUpdate,
} from '../src/commands/milestone-testcase'

const PROJECT_ID = '0123456789abcdef0123456789abcdef'.replace(
  /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
  '$1-$2-$3-$4-$5'
)

let fetchMock: jest.Mock
let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
const stdout = () => logSpy.mock.calls.map(c => String(c[0])).join('\n')

function reply(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as never
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

/** First fetches resolve the project then the milestone by name. */
function queueResolve(name = 'Review v2') {
  fetchMock.mockImplementation(async (url: string) => {
    if (/\/api\/projects\/[^/]+\/milestones/.test(url)) {
      return reply({ milestones: [{ id: 'm-1', name }] })
    }
    if (/\/api\/projects(\?|$)/.test(url)) {
      return reply({
        projects: [{ id: PROJECT_ID, name: 'lumo', slug: 'lumo' }],
      })
    }
    if (/\/test-cases\/TC1\/runs$/.test(url)) {
      return reply({
        run: {
          result: 'PASS',
          environment: 'PRODUCTION',
          failedStepText: null,
        },
        ceiling: { effective: 'PASS' },
      })
    }
    if (/\/test-cases\/TC1$/.test(url)) {
      return reply({
        testCase: { number: 1, title: 'E2E' },
        runs: [
          {
            id: 'run-9',
            result: 'FAIL',
            failureAttribution: 'IMPLEMENTATION_DEFECT',
            evidence: [{}],
            createdAt: '2026-10-14T00:00:00Z',
            disposition: null,
          },
        ],
      })
    }
    if (/\/disposition$/.test(url))
      return reply({ disposition: 'KNOWN_DEFECT' })
    return reply({ testCase: { id: 'c', number: 1, title: 'E2E' } })
  })
}

const urls = () => fetchMock.mock.calls.map(c => String(c[0]))

it('adds a case to a milestone resolved by name', async () => {
  queueResolve()
  const code = await milestoneTestCaseAdd('Review v2', {
    title: 'E2E',
    step: ['open PR'],
    expected: 'comment posted',
    project: 'lumo',
  })
  expect(code).toBeUndefined()
  expect(urls().some(u => /\/api\/milestones\/m-1\/test-cases$/.test(u))).toBe(
    true
  )
  expect(stdout()).toContain('Created Review v2/TC1 "E2E"')
  const post = fetchMock.mock.calls.find(c =>
    /\/api\/milestones\/m-1\/test-cases$/.test(String(c[0]))
  )!
  expect(post[1].method).toBe('POST')
  expect(JSON.parse(post[1].body)).toMatchObject({
    title: 'E2E',
    steps: ['open PR'],
    expected: 'comment posted',
  })
})

it('prints a sanitized milestone label', async () => {
  const esc = String.fromCharCode(0x1b)
  queueResolve(`Evil${esc}[31m name`)
  await milestoneTestCaseAdd(`Evil${esc}[31m name`, {
    title: 'E2E',
    step: ['s'],
    expected: 'e',
    project: 'lumo',
  })
  expect(stdout()).toContain('Created ')
  expect(stdout()).not.toContain(esc)
})

it.each([
  ['show', () => milestoneTestCaseShow('Review v2', undefined, {})],
  [
    'update',
    () => milestoneTestCaseUpdate('Review v2', undefined, { title: 'x' }),
  ],
  ['rm', () => milestoneTestCaseRm('Review v2', undefined, {})],
  [
    'run',
    () =>
      milestoneTestCaseRun('Review v2', undefined, {
        result: 'pass',
        env: 'local',
      }),
  ],
])('%s without a case ref fails before any request', async (_n, call) => {
  expect(await call()).toBe(1)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('dispositions against the milestone route with no task status call', async () => {
  queueResolve()
  await milestoneTestCaseDisposition('Review v2', 'TC1', {
    knownDefect: true,
    confirm: true,
    receipt: 'r2.1.2.3.sig',
    project: 'lumo',
  })
  expect(
    urls().some(u =>
      /\/api\/milestones\/m-1\/test-case-runs\/run-9\/disposition$/.test(u)
    )
  ).toBe(true)
  expect(urls().some(u => u.includes('/api/tasks/'))).toBe(false)
  expect(printStatusDigest).not.toHaveBeenCalled()
})

it.each([
  ['omits pullRequests (older server)', undefined],
  ['sends an empty pullRequests list', []],
])(
  'show prints a run carrying commitSha when the server %s',
  async (_label, pullRequests) => {
    queueResolve()
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string) => {
      if (/\/test-cases\/TC1$/.test(url)) {
        return reply({
          testCase: {
            number: 1,
            title: 'E2E',
            setup: null,
            steps: ['open PR'],
            verification: [],
            expected: 'comment posted',
          },
          runs: [
            {
              id: 'run-1',
              result: 'PASS',
              environment: 'STAGING',
              failedPhase: null,
              failedIndex: null,
              failedStepText: null,
              note: null,
              evidence: [],
              pullRequestId: null,
              commitSha: 'abcdef1234567890',
              commitDirty: false,
              createdAt: '2026-10-14T00:00:00Z',
            },
          ],
          ...(pullRequests ? { pullRequests } : {}),
        })
      }
      return base(url)
    })
    const code = await milestoneTestCaseShow('Review v2', 'TC1', {
      project: 'lumo',
    })
    expect(code).toBeUndefined()
    expect(stdout()).toContain('PASS on STAGING  @abcdef1')
  }
)

it('records a run against TC1', async () => {
  queueResolve()
  await milestoneTestCaseRun('Review v2', 'TC1', {
    result: 'pass',
    env: 'production',
    project: 'lumo',
  })
  expect(
    urls().some(u => /\/api\/milestones\/m-1\/test-cases\/TC1\/runs$/.test(u))
  ).toBe(true)
})

it('rejects --pr on a milestone run before any request', async () => {
  const code = await milestoneTestCaseRun('Review v2', 'TC1', {
    result: 'pass',
    env: 'local',
    pr: '12',
    project: 'lumo',
  })
  expect(code).toBe(2)
  expect(fetchMock).not.toHaveBeenCalled()
})

describe('milestone disposition wording (LUM-1135)', () => {
  let outSpy: jest.SpyInstance
  const written = () => outSpy.mock.calls.map(c => String(c[0])).join('')
  beforeEach(() => {
    outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => outSpy.mockRestore())

  it('a NOT_A_DEFECT ruling says the case still holds the milestone', async () => {
    queueResolve()
    await milestoneTestCaseDisposition('Review v2', 'TC1', {
      notADefect: true,
      confirm: true,
      receipt: 'r2.1.2.3.sig',
      project: 'lumo',
    })
    expect(written()).toContain(
      'The case still holds the milestone close gate until it passes on a re-run.'
    )
    expect(written()).not.toContain('no longer')
  })

  it('a KNOWN_DEFECT ruling says the run no longer holds the gate', async () => {
    queueResolve()
    await milestoneTestCaseDisposition('Review v2', 'TC1', {
      knownDefect: true,
      confirm: true,
      receipt: 'r2.1.2.3.sig',
      project: 'lumo',
    })
    expect(written()).toContain(
      'That run no longer holds the milestone close gate.'
    )
  })

  it('a non-defect latest run explains that every other failure holds the milestone', async () => {
    queueResolve()
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string) => {
      if (/\/test-cases\/TC1$/.test(url)) {
        return reply({
          testCase: { number: 1, title: 'E2E' },
          runs: [
            {
              id: 'run-9',
              result: 'FAIL',
              failureAttribution: 'TEST_DEFECT',
              evidence: [],
              createdAt: '2026-10-14T00:00:00Z',
              disposition: null,
            },
          ],
        })
      }
      return base(url)
    })
    const code = await milestoneTestCaseDisposition('Review v2', 'TC1', {
      knownDefect: true,
      project: 'lumo',
    })
    expect(code).toBe(1)
    const err = errorSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(err).toContain(
      'Only proven defects can be dispositioned — every other failure holds the milestone until the case passes on a re-run.'
    )
    expect(err).not.toContain('never blocked')
  })

  it('the step-1 envelope for NOT_A_DEFECT says the case stays held', async () => {
    queueResolve()
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string) => {
      if (/\/disposition\/receipt$/.test(url)) {
        return reply({
          receipt: 'r1.1.2.3.sig',
          expiresAt: '2026-10-14T00:10:00Z',
          readAt: '2026-10-14T00:00:00Z',
          readAcknowledgedAt: null,
        })
      }
      return base(url)
    })
    const code = await milestoneTestCaseDisposition('Review v2', 'TC1', {
      notADefect: true,
      project: 'lumo',
    })
    expect(code).toBe(4)
    expect(written()).toContain(
      'the case stays held until it passes on a re-run'
    )
    expect(written()).not.toContain('block on DONE')
  })
})
