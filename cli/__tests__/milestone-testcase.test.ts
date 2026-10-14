/**
 * @jest-environment node
 */
jest.mock('../src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('../src/lib/session-id', () => ({ resolveSessionId: jest.fn() }))
jest.mock('../src/lib/status-digest', () => ({ printStatusDigest: jest.fn() }))

import { readCredentials } from '../src/lib/config'
import {
  milestoneTestCaseAdd,
  milestoneTestCaseRun,
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
function queueResolve() {
  fetchMock.mockImplementation(async (url: string) => {
    if (/\/api\/projects\/[^/]+\/milestones/.test(url)) {
      return reply({ milestones: [{ id: 'm-1', name: 'Review v2' }] })
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
})

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
  expect(code).toBe(1)
  expect(fetchMock).not.toHaveBeenCalled()
})
