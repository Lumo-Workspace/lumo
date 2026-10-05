/** @jest-environment node */
//
// LUM-122: documents cache a short LLM summary of their body, generated in the
// background (waitUntil) after create/update. These tests exercise the
// fire-and-forget scheduling helper in isolation — the full create/update
// happy paths live in document.service.test.ts.
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    updateSummary: jest.fn(),
  },
}))
jest.mock('@/lib/services/content-summary.service')
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { documentRepository } from '@/lib/repositories/document.repository'
import { contentSummaryService } from '@/lib/services/content-summary.service'
import { scheduleDocumentSummary } from '@/lib/services/document.service'

const repo = documentRepository as unknown as {
  updateSummary: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('scheduleDocumentSummary', () => {
  it('summarizes the body text with kind "document" and caches the result', async () => {
    ;(contentSummaryService.summarize as jest.Mock).mockResolvedValue('sum')
    repo.updateSummary.mockResolvedValue({})

    scheduleDocumentSummary('doc1', 'ws1', 'the document body')
    await new Promise(r => setImmediate(r))

    expect(contentSummaryService.summarize).toHaveBeenCalledWith(
      'the document body',
      'document'
    )
    expect(repo.updateSummary).toHaveBeenCalledWith('doc1', 'ws1', 'sum')
  })

  it('skips caching when the summary is empty', async () => {
    ;(contentSummaryService.summarize as jest.Mock).mockResolvedValue('')
    repo.updateSummary.mockResolvedValue({})

    scheduleDocumentSummary('doc1', 'ws1', 'x')
    await new Promise(r => setImmediate(r))

    expect(repo.updateSummary).not.toHaveBeenCalled()
  })

  it('swallows summarization errors so they never surface to the caller', async () => {
    ;(contentSummaryService.summarize as jest.Mock).mockRejectedValue(
      new Error('LLM down')
    )

    expect(() => scheduleDocumentSummary('doc1', 'ws1', 'x')).not.toThrow()
    await new Promise(r => setImmediate(r))

    expect(repo.updateSummary).not.toHaveBeenCalled()
  })
})
