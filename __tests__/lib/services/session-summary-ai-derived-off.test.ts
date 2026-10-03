/**
 * LUM-917 — "Generate summary" on a session is refused (409, coded) while
 * the workspace has AI-derived content off; no model is called.
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findByIdForMember: jest.fn(),
    listEventsForSession: jest.fn(),
    updateSummary: jest.fn(),
  },
}))
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: { isEnabled: jest.fn() },
}))
jest.mock('@/lib/services/session-summary/classifier', () => ({
  classifySession: jest.fn(),
}))
jest.mock('@/lib/services/session-summary/templates', () => ({
  generateStructuredSummary: jest.fn(),
}))
jest.mock('@/lib/ai/models', () => ({
  FAST_MODEL: 'fast',
  CONTENT_MODEL: 'content',
}))
jest.mock('ai', () => ({ APICallError: { isInstance: () => false } }))

import { sessionSummaryService } from '@/lib/services/session-summary/service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { classifySession } from '@/lib/services/session-summary/classifier'
import { AI_DERIVED_OFF_CODE } from '@/lib/ai-derived/constants'

it('refuses with AI_DERIVED_OFF_CODE and never calls the model', async () => {
  ;(sessionRepository.findByIdForMember as jest.Mock).mockResolvedValue({
    id: 's1',
    workspaceId: 'w1',
    startedAt: new Date(),
    cwd: null,
  })
  ;(aiDerivedContentService.isEnabled as jest.Mock).mockResolvedValue(false)

  await expect(
    sessionSummaryService.generateSummary({
      sessionId: 's1',
      workspaceMemberId: 'm1',
    })
  ).rejects.toMatchObject({ status: 409, code: AI_DERIVED_OFF_CODE })
  expect(aiDerivedContentService.isEnabled).toHaveBeenCalledWith({
    workspaceId: 'w1',
  })
  expect(sessionRepository.listEventsForSession).not.toHaveBeenCalled()
  expect(classifySession).not.toHaveBeenCalled()
  expect(sessionRepository.updateSummary).not.toHaveBeenCalled()
})
