/**
 * @jest-environment node
 *
 * LUM-1315 — the Codeup (center edition) HTTP client.
 */
import {
  CODEUP_API_BASE,
  CodeupApiError,
  createCodeupClient,
  isCodeupAuthError,
  isValidOrganizationId,
  toRepositorySummary,
} from '@/lib/integrations/codeup/client'

const ORG = '60de7a6852743a5162b5f957'
// Assembled so the fixture is not a credential-shaped literal.
const TOKEN = ['fixture', 'pat', 'value'].join('-')

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

function repo(id: number) {
  return {
    id,
    name: `repo-${id}`,
    pathWithNamespace: `${ORG}/group/repo-${id}`,
    webUrl: `https://codeup.aliyun.com/${ORG}/group/repo-${id}`,
  }
}

describe('createCodeupClient', () => {
  it('lists repositories with the token in the x-yunxiao-token header, never the URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse([repo(1)]))
    const client = createCodeupClient(ORG, TOKEN, fetchImpl)

    const repos = await client.listRepositories()

    expect(repos).toEqual([repo(1)])
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(
      `${CODEUP_API_BASE}/oapi/v1/codeup/organizations/${ORG}/repositories?page=1&perPage=100&archived=false`
    )
    expect(url).not.toContain(TOKEN)
    expect(init.method).toBe('GET')
    expect(init.headers['x-yunxiao-token']).toBe(TOKEN)
  })

  it('follows x-next-page while pages are full', async () => {
    const full = Array.from({ length: 100 }, (_, i) => repo(i + 1))
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(full, { headers: { 'x-next-page': '2' } })
      )
      .mockResolvedValueOnce(jsonResponse([repo(101)]))
    const repos = await createCodeupClient(
      ORG,
      TOKEN,
      fetchImpl
    ).listRepositories()
    expect(repos).toHaveLength(101)
    expect(fetchImpl.mock.calls[1]![0]).toContain('page=2')
  })

  it('drops rows missing the fields Lumo needs', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse([repo(1), { id: 2 }, null]))
    const repos = await createCodeupClient(
      ORG,
      TOKEN,
      fetchImpl
    ).listRepositories()
    expect(repos.map(r => r.id)).toEqual([1])
  })

  it('throws CodeupApiError with the HTTP status on a refused call, without the token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ errorCode: 'x' }, { status: 401 }))
    const err = await createCodeupClient(ORG, TOKEN, fetchImpl)
      .listRepositories()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CodeupApiError)
    expect((err as CodeupApiError).status).toBe(401)
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('creates a push + merge request webhook carrying the token in the body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ id: 77 }))
    const hook = await createCodeupClient(ORG, TOKEN, fetchImpl).createWebhook(
      14,
      { url: 'https://lumo.example/api/webhooks/codeup', token: 'hook-tok' }
    )
    expect(hook).toEqual({ id: 77 })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(
      `${CODEUP_API_BASE}/oapi/v1/codeup/organizations/${ORG}/repositories/14/webhooks`
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({
      url: 'https://lumo.example/api/webhooks/codeup',
      token: 'hook-tok',
      pushEvents: true,
      mergeRequestsEvents: true,
      noteEvents: false,
    })
  })

  it('rejects a webhook answer without an id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}))
    await expect(
      createCodeupClient(ORG, TOKEN, fetchImpl).createWebhook(14, {
        url: 'u',
        token: 't',
      })
    ).rejects.toBeInstanceOf(CodeupApiError)
  })

  it('deletes a webhook by repository and hook id', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ result: true }))
    await createCodeupClient(ORG, TOKEN, fetchImpl).deleteWebhook(14, 77)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(
      `${CODEUP_API_BASE}/oapi/v1/codeup/organizations/${ORG}/repositories/14/webhooks/77`
    )
    expect(init.method).toBe('DELETE')
  })

  it('refuses an organization id that could change the path', () => {
    expect(() => createCodeupClient('../evil', TOKEN)).toThrow(CodeupApiError)
  })
})

describe('helpers', () => {
  it('isValidOrganizationId accepts opaque ids only', () => {
    expect(isValidOrganizationId(ORG)).toBe(true)
    expect(isValidOrganizationId('a/b')).toBe(false)
    expect(isValidOrganizationId('')).toBe(false)
  })

  it('isCodeupAuthError is true for 401/403/404 only', () => {
    expect(isCodeupAuthError(new CodeupApiError(401, 'x'))).toBe(true)
    expect(isCodeupAuthError(new CodeupApiError(403, 'x'))).toBe(true)
    expect(isCodeupAuthError(new CodeupApiError(404, 'x'))).toBe(true)
    expect(isCodeupAuthError(new CodeupApiError(500, 'x'))).toBe(false)
    expect(isCodeupAuthError(new Error('x'))).toBe(false)
  })

  it('toRepositorySummary falls back to the path for a missing name', () => {
    expect(
      toRepositorySummary({ id: 3, pathWithNamespace: 'o/r', webUrl: 'w' })
    ).toEqual({ id: 3, name: 'o/r', pathWithNamespace: 'o/r', webUrl: 'w' })
    expect(toRepositorySummary('nope')).toBeNull()
  })
})
