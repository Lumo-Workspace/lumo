const embedManyMock = jest.fn()
jest.mock('ai', () => ({ embedMany: (...a: unknown[]) => embedManyMock(...a) }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: { textEmbeddingModel: (id: string) => ({ id }) },
}))

import { embedTexts, EMBEDDING_MODEL, EMBEDDING_DIM } from '@/lib/ai/embedding'

beforeEach(() => embedManyMock.mockReset())

describe('embedTexts', () => {
  it('exports the qwen3 model id and 1024 dim', () => {
    expect(EMBEDDING_MODEL).toBe('alibaba/qwen3-embedding-0.6b')
    expect(EMBEDDING_DIM).toBe(1024)
  })

  it('returns [] for empty input without calling the model', async () => {
    expect(await embedTexts([])).toEqual([])
    expect(embedManyMock).not.toHaveBeenCalled()
  })

  it('embeds N texts in one call and returns the vectors', async () => {
    embedManyMock.mockResolvedValue({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    })
    const out = await embedTexts(['a', 'b'])
    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    const arg = embedManyMock.mock.calls[0]![0] as {
      values: string[]
      model: { id: string }
    }
    expect(arg.values).toEqual(['a', 'b'])
    expect(arg.model.id).toBe('alibaba/qwen3-embedding-0.6b')
  })

  it('propagates model errors (caller decides fallback)', async () => {
    embedManyMock.mockRejectedValue(new Error('gateway down'))
    await expect(embedTexts(['a'])).rejects.toThrow('gateway down')
  })
})
