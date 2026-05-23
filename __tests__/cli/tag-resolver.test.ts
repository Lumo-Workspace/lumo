/**
 * @jest-environment node
 */
import { resolveTagRefs } from '@/cli/src/lib/tag-resolver'

describe('resolveTagRefs', () => {
  it('returns explicit ids unchanged when no names given', async () => {
    const fetchMock = jest.fn()
    const ids = await resolveTagRefs(
      { names: [], ids: ['c00000000000000000000001a'] },
      { apiUrl: 'https://api', token: 't', fetchImpl: fetchMock }
    )
    expect(ids).toEqual(['c00000000000000000000001a'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls /api/tags/resolve with deduped names and merges returned ids with explicit ids', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tags: [
          { id: 'c1', name: 'urgent' },
          { id: 'c2', name: 'rfc' },
        ],
      }),
    })
    const ids = await resolveTagRefs(
      { names: ['urgent', 'URGENT', 'rfc'], ids: ['c3'] },
      { apiUrl: 'https://api', token: 't', fetchImpl: fetchMock }
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api/api/tags/resolve',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"urgent"'),
      })
    )
    expect(ids.sort()).toEqual(['c1', 'c2', 'c3'].sort())
  })

  it('throws on non-2xx server response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad',
      text: async () => 'oops',
    })
    await expect(
      resolveTagRefs(
        { names: ['x'], ids: [] },
        { apiUrl: 'https://api', token: 't', fetchImpl: fetchMock }
      )
    ).rejects.toThrow(/400/)
  })

  it('trims whitespace and rejects empty-after-trim names locally', async () => {
    await expect(
      resolveTagRefs(
        { names: ['  '], ids: [] },
        { apiUrl: 'https://api', token: 't', fetchImpl: jest.fn() }
      )
    ).rejects.toThrow(/empty/)
  })
})
