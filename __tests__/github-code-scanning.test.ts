/** @jest-environment node */
import {
  fetchCodeScanningAlerts,
  fetchActiveSecretScanningAlerts,
  ALERTS_PAGE_SIZE,
  MAX_SECRET_ALERT_LOCATIONS,
} from '@/lib/integrations/github/code-scanning'

jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const realFetch = global.fetch
function setFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>
): jest.Mock {
  const mock = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init)
  )
  ;(global as { fetch: unknown }).fetch = mock
  return mock
}
afterEach(() => {
  ;(global as { fetch: unknown }).fetch = realFetch
})

const OPTS = { workspaceId: 'w1', fullName: 'o/r', prNumber: 7 }

describe('fetchCodeScanningAlerts', () => {
  it('queries the PR-filtered open alerts and reduces each to the kept fields', async () => {
    const fetchMock = setFetch(async () =>
      response(200, [
        {
          number: 7,
          html_url: 'https://github.com/o/r/security/code-scanning/7',
          rule: {
            id: 'js/sqli',
            description: 'SQL injection',
            severity: 'error',
            security_severity_level: 'high',
            tags: ['security', 'external/cwe/cwe-089'],
          },
          tool: { name: 'CodeQL', version: '2.0' },
          most_recent_instance: {
            location: { path: 'src/db.ts', start_line: 12 },
            message: { text: 'Untrusted input' },
          },
        },
        {
          number: 8,
          html_url: 'u8',
          rule: null,
          tool: null,
          most_recent_instance: null,
        },
      ])
    )
    const res = await fetchCodeScanningAlerts(OPTS)
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/repos/o/r/code-scanning/alerts?')
    expect(url).toContain('pr=7')
    expect(url).toContain('state=open')
    expect(url).toContain(`per_page=${ALERTS_PAGE_SIZE}`)
    expect(res).toEqual({
      configured: true,
      truncated: false,
      alerts: [
        {
          number: 7,
          htmlUrl: 'https://github.com/o/r/security/code-scanning/7',
          toolName: 'CodeQL',
          ruleId: 'js/sqli',
          ruleDescription: 'SQL injection',
          securitySeverityLevel: 'high',
          severity: 'error',
          path: 'src/db.ts',
          startLine: 12,
          messageText: 'Untrusted input',
        },
        {
          number: 8,
          htmlUrl: 'u8',
          toolName: 'unknown',
          ruleId: 'unknown',
          ruleDescription: null,
          securitySeverityLevel: null,
          severity: null,
          path: null,
          startLine: null,
          messageText: null,
        },
      ],
    })
  })

  it('treats 403 and 404 as "not configured", not as a failure', async () => {
    setFetch(async () =>
      response(403, {
        message:
          'Advanced Security must be enabled for this repository to use code scanning.',
      })
    )
    expect(await fetchCodeScanningAlerts(OPTS)).toEqual({
      configured: false,
      reason:
        'Advanced Security must be enabled for this repository to use code scanning.',
    })
    setFetch(async () => response(404, { message: 'no analysis found' }))
    expect(await fetchCodeScanningAlerts(OPTS)).toMatchObject({
      configured: false,
    })
  })

  it('throws with the status on any other error so the stage reads FAILED', async () => {
    setFetch(async () => response(500, { message: 'boom' }))
    await expect(fetchCodeScanningAlerts(OPTS)).rejects.toMatchObject({
      status: 500,
    })
  })

  it('flags truncation when a full page comes back', async () => {
    setFetch(async () =>
      response(
        200,
        Array.from({ length: ALERTS_PAGE_SIZE }, (_, i) => ({
          number: i,
          html_url: `u${i}`,
        }))
      )
    )
    const res = await fetchCodeScanningAlerts(OPTS)
    expect(res).toMatchObject({ configured: true, truncated: true })
  })
})

describe('fetchActiveSecretScanningAlerts', () => {
  it('lists active open alerts, resolves their commit locations, and NEVER carries the secret', async () => {
    const fetchMock = setFetch(async url => {
      if (url.includes('/secret-scanning/alerts/3/locations')) {
        return response(200, [
          { type: 'commit', details: { path: 'src/cfg.ts', start_line: 3 } },
          { type: 'commit', details: { path: 'src/cfg.ts', start_line: 9 } },
          { type: 'issue_body', details: { issue_body_url: 'x' } },
        ])
      }
      return response(200, [
        {
          number: 3,
          html_url: 'https://github.com/o/r/security/secret-scanning/3',
          secret_type: 'github_personal_access_token',
          secret_type_display_name: 'GitHub Personal Access Token',
          validity: 'active',
          secret: SECRET,
        },
      ])
    })
    const res = await fetchActiveSecretScanningAlerts({
      workspaceId: 'w1',
      fullName: 'o/r',
    })
    const listUrl = String(fetchMock.mock.calls[0]![0])
    expect(listUrl).toContain('/repos/o/r/secret-scanning/alerts?')
    expect(listUrl).toContain('state=open')
    expect(listUrl).toContain('validity=active')
    expect(res).toEqual({
      configured: true,
      truncated: false,
      alerts: [
        {
          number: 3,
          htmlUrl: 'https://github.com/o/r/security/secret-scanning/3',
          secretType: 'github_personal_access_token',
          secretTypeDisplayName: 'GitHub Personal Access Token',
          paths: ['src/cfg.ts'],
        },
      ],
    })
    expect(JSON.stringify(res)).not.toContain(SECRET)
  })

  it('drops alerts whose validity is not active even if the API returned them', async () => {
    setFetch(async url =>
      url.includes('/locations')
        ? response(200, [])
        : response(200, [
            {
              number: 1,
              html_url: 'u1',
              secret_type: 'x_y',
              validity: 'inactive',
            },
            {
              number: 2,
              html_url: 'u2',
              secret_type: 'x_y',
              validity: 'unknown',
            },
          ])
    )
    const res = await fetchActiveSecretScanningAlerts({
      workspaceId: 'w1',
      fullName: 'o/r',
    })
    expect(res).toMatchObject({ configured: true, alerts: [] })
  })

  it('caps location lookups and marks the result partial past the cap', async () => {
    const fetchMock = setFetch(async url =>
      url.includes('/locations')
        ? response(200, [{ type: 'commit', details: { path: 'p' } }])
        : response(
            200,
            Array.from({ length: MAX_SECRET_ALERT_LOCATIONS + 1 }, (_, i) => ({
              number: i,
              html_url: `u${i}`,
              secret_type: 'x_y',
              validity: 'active',
            }))
          )
    )
    const res = await fetchActiveSecretScanningAlerts({
      workspaceId: 'w1',
      fullName: 'o/r',
    })
    const locationCalls = fetchMock.mock.calls.filter(c =>
      String(c[0]).includes('/locations')
    )
    expect(locationCalls).toHaveLength(MAX_SECRET_ALERT_LOCATIONS)
    expect(res).toMatchObject({ configured: true, truncated: true })
  })

  it('treats 403/404 as not configured; a failed location lookup keeps the alert with no paths', async () => {
    setFetch(async () =>
      response(404, { message: 'Secret scanning is disabled' })
    )
    expect(
      await fetchActiveSecretScanningAlerts({
        workspaceId: 'w1',
        fullName: 'o/r',
      })
    ).toEqual({
      configured: false,
      reason: 'Secret scanning is disabled',
    })
    setFetch(async url =>
      url.includes('/locations')
        ? response(500, { message: 'boom' })
        : response(200, [
            {
              number: 1,
              html_url: 'u1',
              secret_type: 'x_y',
              validity: 'active',
            },
          ])
    )
    const res = await fetchActiveSecretScanningAlerts({
      workspaceId: 'w1',
      fullName: 'o/r',
    })
    expect(res).toMatchObject({
      configured: true,
      alerts: [{ number: 1, paths: [] }],
    })
  })
})
