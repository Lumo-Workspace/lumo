import { describe, it, expect } from '@jest/globals'
import * as gate from '@/lib/notifications/preferenceGate'

describe('preferenceGate mention type mapping', () => {
  it('exports the new mention types mapped to the mention preference fields', () => {
    expect(gate.MENTION_NOTIFICATION_TYPES).toEqual(
      expect.arrayContaining([
        'TASK_MENTIONED',
        'DOCUMENT_COMMENT_MENTIONED',
        'PROJECT_MENTIONED',
        'MILESTONE_MENTIONED',
        'DOCUMENT_MENTIONED',
      ])
    )
  })
})
