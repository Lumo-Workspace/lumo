import { fetchCommitCiSignals } from '@/lib/integrations/github/checks'

jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response
}

const realFetch = global.fetch

function setFetch(
  impl: (input: RequestInfo | URL) => Promise<Response>
): jest.Mock {
  const mock = jest.fn(impl)
  ;(global as { fetch: unknown }).fetch = mock
  return mock
}

describe('fetchCommitCiSignals (LUM-616)', () => {
  afterEach(() => {
    ;(global as { fetch: unknown }).fetch = realFetch
    jest.restoreAllMocks()
  })

  it('fetchCommitCiSignals merges check runs and statuses into one uniform list', async () => {
    const fetchMock = setFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/check-runs')) {
        return jsonResponse({
          check_runs: [
            {
              name: 'Vercel',
              conclusion: 'success',
              details_url: 'https://ci/checks/1',
            },
          ],
        })
      }
      // combined commit status
      return jsonResponse({
        statuses: [
          {
            context: 'ci/circleci: test',
            state: 'failure',
            target_url: 'https://ci/status/2',
          },
        ],
      })
    })

    const signals = await fetchCommitCiSignals({
      workspaceId: 'ws1',
      fullName: 'acme/app',
      sha: 'deadbeef',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(signals).toEqual(
      expect.arrayContaining([
        {
          name: 'Vercel',
          outcome: 'success',
          detailsUrl: 'https://ci/checks/1',
          source: 'github_check',
        },
        {
          name: 'ci/circleci: test',
          outcome: 'failure',
          detailsUrl: 'https://ci/status/2',
          source: 'github_status',
        },
      ])
    )
  })

  it('still returns the other source when one endpoint fails', async () => {
    setFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/check-runs')) {
        throw new Error('network down')
      }
      return jsonResponse({
        statuses: [{ context: 'build', state: 'success', target_url: null }],
      })
    })

    const signals = await fetchCommitCiSignals({
      workspaceId: 'ws1',
      fullName: 'acme/app',
      sha: 'deadbeef',
    })

    // check-runs threw, but the status source survived
    expect(signals).toEqual([
      {
        name: 'build',
        outcome: 'success',
        detailsUrl: null,
        source: 'github_status',
      },
    ])
  })
})

// LUM-838: a check that never executed is not a verdict. The PR 1099 shape: an
// Actions job refused by a billing/spending-limit block completes with
// conclusion=failure, zero steps and no runner; the only explanation is a
// check-run annotation.
describe('fetchCommitCiSignals — checks that never ran (LUM-838)', () => {
  afterEach(() => {
    ;(global as { fetch: unknown }).fetch = realFetch
    jest.restoreAllMocks()
  })

  const BILLING_MESSAGE =
    'The job was not started because recent account payments have failed or your spending limit needs to be increased.'

  function actionsRun(id: number, name: string, conclusion: string) {
    return {
      id,
      name,
      conclusion,
      app: { slug: 'github-actions' },
      details_url: `https://ci/job/${id}`,
      output: { annotations_count: 2 },
    }
  }

  function failResponse(status: number): Response {
    return { ok: false, status, json: async () => ({}) } as unknown as Response
  }

  it('an Actions job that never started yields no verdict', async () => {
    const fetchMock = setFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/commits/') && url.endsWith('/check-runs')) {
        return jsonResponse({
          check_runs: [
            actionsRun(11, 'test', 'failure'),
            actionsRun(12, 'typecheck', 'failure'),
          ],
        })
      }
      if (url.includes('/actions/jobs/')) {
        return jsonResponse({ steps: [], runner_name: '', runner_id: 0 })
      }
      if (url.includes('/annotations')) {
        return jsonResponse([
          { annotation_level: 'notice', message: 'ubuntu-latest will migrate' },
          { annotation_level: 'failure', message: BILLING_MESSAGE },
        ])
      }
      return jsonResponse({ statuses: [] })
    })

    const signals = await fetchCommitCiSignals({
      workspaceId: 'ws1',
      fullName: 'acme/app',
      sha: 'deadbeef',
    })

    expect(signals).toEqual([
      {
        name: 'test',
        outcome: 'not_run',
        detailsUrl: 'https://ci/job/11',
        source: 'github_check',
        notRunReason: BILLING_MESSAGE,
      },
      {
        name: 'typecheck',
        outcome: 'not_run',
        detailsUrl: 'https://ci/job/12',
        source: 'github_check',
        notRunReason: BILLING_MESSAGE,
      },
    ])
    expect(signals.some(s => s.outcome === 'failure')).toBe(false)
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls).toContain(
      'https://api.github.com/repos/acme/app/actions/jobs/11'
    )
    expect(urls).toContain(
      'https://api.github.com/repos/acme/app/check-runs/11/annotations'
    )
  })

  it('never-executed conclusions yield no verdict but real failures still fail', async () => {
    const fetchMock = setFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/commits/') && url.endsWith('/check-runs')) {
        return jsonResponse({
          check_runs: [
            { id: 1, name: 'a', conclusion: 'startup_failure' },
            { id: 2, name: 'b', conclusion: 'cancelled' },
            { id: 3, name: 'c', conclusion: 'stale' },
            { id: 4, name: 'd', conclusion: 'action_required' },
            { id: 5, name: 'e', conclusion: 'timed_out' },
            actionsRun(6, 'test', 'failure'),
            // a non-Actions app: no job to inspect, failure stays failure
            { id: 7, name: 'ci/other', conclusion: 'failure' },
          ],
        })
      }
      if (url.includes('/actions/jobs/6')) {
        // the job ran: a runner picked it up and steps executed
        return jsonResponse({
          steps: [{ name: 'Set up job', conclusion: 'success' }],
          runner_name: 'GitHub Actions 12',
        })
      }
      return jsonResponse({ statuses: [] })
    })

    const signals = await fetchCommitCiSignals({
      workspaceId: 'ws1',
      fullName: 'acme/app',
      sha: 'deadbeef',
    })

    const byName = Object.fromEntries(signals.map(s => [s.name, s.outcome]))
    expect(byName).toEqual({
      a: 'not_run',
      b: 'not_run',
      c: 'not_run',
      d: 'not_run',
      e: 'failure',
      test: 'failure',
      'ci/other': 'failure',
    })
    expect(signals.find(s => s.name === 'a')?.notRunReason).toContain(
      'startup_failure'
    )
    // a job that ran needs no annotation lookup, and non-Actions apps no job lookup
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.filter(u => u.includes('/annotations'))).toEqual([])
    expect(urls.filter(u => u.includes('/actions/jobs/'))).toEqual([
      'https://api.github.com/repos/acme/app/actions/jobs/6',
    ])
  })

  it('a failed job lookup keeps the failure and the other signals', async () => {
    setFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/commits/') && url.endsWith('/check-runs')) {
        return jsonResponse({
          check_runs: [
            actionsRun(21, 'test', 'failure'),
            { id: 22, name: 'Vercel', conclusion: 'success' },
          ],
        })
      }
      if (url.includes('/actions/jobs/')) return failResponse(403)
      return jsonResponse({
        statuses: [{ context: 'build', state: 'success', target_url: null }],
      })
    })

    const signals = await fetchCommitCiSignals({
      workspaceId: 'ws1',
      fullName: 'acme/app',
      sha: 'deadbeef',
    })

    expect(signals.map(s => [s.name, s.outcome])).toEqual([
      ['test', 'failure'],
      ['Vercel', 'success'],
      ['build', 'success'],
    ])
  })
})
