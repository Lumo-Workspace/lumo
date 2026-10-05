import { apiFetch, apiFetchQuiet, ApiClientError } from '@/lib/api-client/base'

const mockFetch = jest.fn()
global.fetch = mockFetch

function mockResponse(
  body: unknown,
  init: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}
) {
  const { status = 200, ok = true } = init
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  }
}

function mockNonJsonResponse(status: number) {
  return {
    ok: false,
    status,
    json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('apiFetch', () => {
  it('successful GET returns parsed JSON', async () => {
    const data = { id: 1, name: 'Test' }
    mockFetch.mockResolvedValue(mockResponse(data))

    const result = await apiFetch<{ id: number; name: string }>('/api/test')

    expect(result).toEqual(data)
    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'GET',
      signal: undefined,
      headers: {},
    })
  })

  it('POST with body sets Content-Type and serializes body', async () => {
    const payload = { title: 'New item' }
    const responseData = { id: 2, title: 'New item' }
    mockFetch.mockResolvedValue(mockResponse(responseData))

    const result = await apiFetch('/api/items', {
      method: 'POST',
      body: payload,
    })

    expect(result).toEqual(responseData)
    expect(mockFetch).toHaveBeenCalledWith('/api/items', {
      method: 'POST',
      signal: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('non-ok response throws ApiClientError with status and parsed message', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        { message: 'Not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404, ok: false }
      )
    )

    await expect(apiFetch('/api/missing')).rejects.toThrow(ApiClientError)

    try {
      await apiFetch('/api/missing')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      const apiErr = err as ApiClientError
      expect(apiErr.message).toBe('Not found')
      expect(apiErr.status).toBe(404)
      expect(apiErr.code).toBe('RESOURCE_NOT_FOUND')
    }
  })

  it('non-ok response with non-JSON body throws ApiClientError with default message', async () => {
    mockFetch.mockResolvedValue(mockNonJsonResponse(500))

    try {
      await apiFetch('/api/broken')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      const apiErr = err as ApiClientError
      expect(apiErr.message).toBe('Request failed with status 500')
      expect(apiErr.status).toBe(500)
      expect(apiErr.code).toBe('API_ERROR')
    }
  })

  it('204 response returns undefined', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: jest.fn(),
    })

    const result = await apiFetch('/api/resource')

    expect(result).toBeUndefined()
  })

  it('passes signal through to fetch', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValue(mockResponse({ ok: true }))

    await apiFetch('/api/test', { signal: controller.signal })

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'GET',
      signal: controller.signal,
      headers: {},
    })
  })

  it('GET without body does NOT set Content-Type header', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [] }))

    await apiFetch('/api/list')

    const callArgs = mockFetch.mock.calls[0][1]
    expect(callArgs.headers).not.toHaveProperty('Content-Type')
    expect(callArgs).not.toHaveProperty('body')
  })

  it('FormData body skips Content-Type and is passed through unchanged', async () => {
    const fd = new FormData()
    fd.append('file', new Blob(['x']), 'a.txt')
    mockFetch.mockResolvedValue(mockResponse({ url: '/cdn/a.txt' }))

    await apiFetch('/api/upload', { method: 'POST', body: fd })

    const callArgs = mockFetch.mock.calls[0][1]
    // The browser fills in `Content-Type: multipart/form-data; boundary=...`
    // itself — we must NOT pre-set it, or the boundary parameter is lost
    // and the server can't parse the upload.
    expect(callArgs.headers).not.toHaveProperty('Content-Type')
    expect(callArgs.body).toBe(fd)
  })
})

describe('apiFetchQuiet', () => {
  it('swallows errors silently', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({ message: 'Server error' }, { status: 500, ok: false })
    )

    await expect(apiFetchQuiet('/api/fail')).resolves.toBeUndefined()
  })

  it('succeeds normally when fetch succeeds', async () => {
    mockFetch.mockResolvedValue(mockResponse({ success: true }))

    await expect(apiFetchQuiet('/api/ok')).resolves.toBeUndefined()
  })
})

describe('apiFetch — LUM-987 active workspace header', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/')
    document
      .querySelectorAll('meta[name="lumo-workspace"]')
      .forEach(m => m.remove())
  })

  it('sends the /workspace/<slug> URL slug as X-Lumo-Workspace', async () => {
    window.history.pushState({}, '', '/workspace/acme/my-tasks/LUM-1')
    mockFetch.mockResolvedValue(mockResponse({}))
    await apiFetch('/api/tasks/t1')
    expect(mockFetch.mock.calls[0][1].headers).toEqual({
      'X-Lumo-Workspace': 'acme',
    })
  })

  it('falls back to a lumo-workspace <meta> on a workspace-less page', async () => {
    window.history.pushState({}, '', '/sessions/s1')
    const meta = document.createElement('meta')
    meta.name = 'lumo-workspace'
    meta.content = 'bravo'
    document.head.appendChild(meta)
    mockFetch.mockResolvedValue(mockResponse({}))
    await apiFetch('/api/sessions/s1/raw-record')
    expect(mockFetch.mock.calls[0][1].headers).toEqual({
      'X-Lumo-Workspace': 'bravo',
    })
  })

  it('sends no header when the page has no workspace', async () => {
    window.history.pushState({}, '', '/onboarding')
    mockFetch.mockResolvedValue(mockResponse({}))
    await apiFetch('/api/workspaces')
    expect(mockFetch.mock.calls[0][1].headers).toEqual({})
  })

  it('an explicit caller header wins over the URL slug', async () => {
    window.history.pushState({}, '', '/workspace/acme')
    mockFetch.mockResolvedValue(mockResponse({}))
    await apiFetch('/api/x', { headers: { 'X-Lumo-Workspace': 'other' } })
    expect(mockFetch.mock.calls[0][1].headers).toEqual({
      'X-Lumo-Workspace': 'other',
    })
  })
})
