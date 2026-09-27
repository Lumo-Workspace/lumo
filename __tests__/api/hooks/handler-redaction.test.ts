/**
 * @jest-environment node
 *
 * LUM-855: the hook handler persists the redacted payload (no customer code),
 * while in-request side effects — boundary detection / secret scanning — still
 * receive the full payload in memory.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/services/auto-block.service', () => ({
  autoBlockService: { onProgressRecorded: jest.fn() },
}))
jest.mock('@/lib/services/boundary-detector.service', () => {
  const actual = jest.requireActual('@/lib/services/boundary-detector.service')
  return {
    ...actual,
    boundaryDetectorService: {
      detectAndRecord: jest.fn(),
      detectAndRecordStewardArtifact: jest.fn(),
    },
  }
})

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import {
  boundaryDetectorService,
  detectCrossings,
} from '@/lib/services/boundary-detector.service'
import { POST } from '@/app/api/hooks/post-tool-use/route'
import { readRedactedStats } from '@/lib/hook-payload/redact'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock
const mockDetect = boundaryDetectorService.detectAndRecord as jest.Mock

// Built by concatenation so no credential-shaped literal sits in the repo.
const FAKE_KEY = ['AKIA', 'QWERTYUIOPASDFGH'].join('')
const WRITTEN = `export const awsKey = "${FAKE_KEY}"\n`
const FILE = '/repo/lib/aws.ts'

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue({
    user: { id: 'clerk_1', email: 'a@b', name: 'A' },
    workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
    apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
  })
  mockRecord.mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: 'task_1',
    toolName: 'Write',
    filePath: FILE,
  })
})

describe('hook handler redaction', () => {
  it('hook handler persists the redacted payload and hands the full payload to afterRecord', async () => {
    const res = await POST(
      new Request('http://x/api/hooks/post-tool-use', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer lum_ok',
        },
        body: JSON.stringify({
          session_id: 'sess_1',
          tool_name: 'Write',
          tool_input: { file_path: FILE, content: WRITTEN },
          tool_response: { type: 'create', filePath: FILE, content: WRITTEN },
        }),
      })
    )
    expect(res.status).toBe(200)

    const stored = mockRecord.mock.calls[0][0].payload
    expect(JSON.stringify(stored)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(stored)).not.toContain('awsKey')
    expect(stored.tool_input).toEqual({ file_path: FILE })
    expect(readRedactedStats(stored, 'tool_input.content')?.lines).toBe(2)

    expect(mockDetect).toHaveBeenCalledTimes(1)
    const detectorInput = mockDetect.mock.calls[0][0]
    expect(detectorInput.payload.tool_input.content).toBe(WRITTEN)

    // The detector still finds the secret from the in-memory payload.
    const crossings = detectCrossings(detectorInput)
    expect(crossings.map(c => c.category)).toContain('HARDCODED_SECRET')
  })
})
