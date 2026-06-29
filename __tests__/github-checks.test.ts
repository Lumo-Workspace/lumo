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
