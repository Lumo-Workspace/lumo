/** @jest-environment jsdom */
import { feedbackClient } from '@/lib/api-client/feedback'

const mockFetch = jest.fn()
jest.mock('@/lib/api-client/base', () => ({
  apiFetch: (...a: unknown[]) => mockFetch(...a),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

const png = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('LUM-1287 feedbackClient', () => {
  it('create POSTs multipart with the JSON payload part and no files', async () => {
    mockFetch.mockResolvedValue({ feedback: { ref: 'FB-3', id: 'f1' } })
    const out = await feedbackClient.create({ kind: 'IDEA', title: 'T' })

    expect(out).toEqual({ ref: 'FB-3', id: 'f1' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(opts.method).toBe('POST')
    const form = opts.body as FormData
    expect(JSON.parse(form.get('payload') as string)).toEqual({
      kind: 'IDEA',
      title: 'T',
    })
    expect(form.getAll('file')).toHaveLength(0)
  })

  it('attachEvidence POSTs one file to the report’s evidence route', async () => {
    mockFetch.mockResolvedValue({})
    const file = png('a.png')
    await feedbackClient.attachEvidence('FB-3', file)

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/feedback/FB-3/evidence')
    expect(opts.method).toBe('POST')
    expect((opts.body as FormData).getAll('file')).toHaveLength(1)
  })

  it('submit creates first, then uploads each screenshot in order', async () => {
    mockFetch.mockResolvedValueOnce({ feedback: { ref: 'FB-7' } })
    mockFetch.mockResolvedValue({})
    const out = await feedbackClient.submit({ kind: 'BUG', title: 'T' }, [
      png('a.png'),
      png('b.png'),
    ])

    expect(out).toEqual({ ref: 'FB-7', failedFiles: [] })
    expect(mockFetch.mock.calls.map(c => c[0])).toEqual([
      '/api/feedback',
      '/api/feedback/FB-7/evidence',
      '/api/feedback/FB-7/evidence',
    ])
  })

  it('submit keeps the report when a screenshot fails, and returns that file', async () => {
    const bad = png('bad.png')
    mockFetch.mockResolvedValueOnce({ feedback: { ref: 'FB-8' } })
    mockFetch.mockRejectedValueOnce(new Error('413'))
    mockFetch.mockResolvedValueOnce({})
    const out = await feedbackClient.submit({ kind: 'BUG', title: 'T' }, [
      bad,
      png('ok.png'),
    ])

    expect(out.ref).toBe('FB-8')
    expect(out.failedFiles).toEqual([bad])
  })

  it('submit rejects without uploading when the report itself fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('429'))
    await expect(
      feedbackClient.submit({ kind: 'BUG', title: 'T' }, [png('a.png')])
    ).rejects.toThrow('429')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
