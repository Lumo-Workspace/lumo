/**
 * @jest-environment node
 *
 * LUM-859 — credentials are redacted out of the stored hook payload, but the
 * boundary detector still sees the original text (its secret checks need it).
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/services/boundary-detector.service', () => ({
  boundaryDetectorService: { detectAndRecord: jest.fn() },
}))
jest.mock('@/lib/services/auto-block.service', () => ({
  autoBlockService: { onProgressRecorded: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: unknown) => {
    void Promise.resolve(p).catch(() => {})
  },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { POST as postToolUse } from '@/app/api/hooks/post-tool-use/route'
import { POST as userPromptSubmit } from '@/app/api/hooks/user-prompt-submit/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock
const mockDetect = boundaryDetectorService.detectAndRecord as jest.Mock

// Built by concatenation so this file never holds a credential-shaped literal.
const AWS_KEY = 'AKIA' + 'Q3ZT7XW2PL9MN4RB'
const GH_PAT = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function req(path: string, body: unknown) {
  return new Request(`http://x/api/hooks/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

function storedPayload(): string {
  return JSON.stringify(mockRecord.mock.calls[0][0].payload)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
  mockRecord.mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: 't-1',
    toolName: 'Write',
    filePath: 'config.ts',
  })
  mockDetect.mockResolvedValue(undefined)
})

describe('hook handler — storage redaction (LUM-859)', () => {
  it('persists a redacted payload but hands the raw payload to the boundary detector', async () => {
    const payload = {
      session_id: 'sess_1',
      tool_name: 'Write',
      tool_input: {
        file_path: 'config.ts',
        content: `export const key = '${AWS_KEY}'\n`,
      },
      tool_response: { stdout: `token=${GH_PAT}` },
    }
    const res = await postToolUse(req('post-tool-use', payload))
    expect(res.status).toBe(200)

    // Stored copy: neither credential survives, a redaction marker is stamped,
    // and non-secret fields are intact.
    const stored = storedPayload()
    expect(stored).not.toContain(AWS_KEY)
    expect(stored).not.toContain(GH_PAT)
    expect(stored).toContain('AKIA…(len 20)')
    const storedObj = mockRecord.mock.calls[0][0].payload
    expect(storedObj._lumo_redaction).toEqual({ count: 2 })
    expect(storedObj.tool_input.file_path).toBe('config.ts')
    expect(storedObj.session_id).toBe('sess_1')

    // Detector copy: the original text, so HARDCODED_SECRET can still fire.
    expect(mockDetect).toHaveBeenCalledTimes(1)
    const detected = mockDetect.mock.calls[0][0].payload
    expect(detected.tool_input.content).toContain(AWS_KEY)
    expect(detected.tool_response.stdout).toContain(GH_PAT)
    expect(detected._lumo_redaction).toBeUndefined()
  })

  it('redacts a credential pasted into a user prompt', async () => {
    mockRecord.mockResolvedValue({
      id: 'he_2',
      sessionId: 'sess_1',
      taskId: 't-1',
      toolName: null,
      filePath: null,
    })
    const res = await userPromptSubmit(
      req('user-prompt-submit', {
        session_id: 'sess_1',
        prompt: `use this key ${AWS_KEY} please`,
      })
    )
    expect(res.status).toBe(200)
    const stored = mockRecord.mock.calls[0][0].payload
    expect(stored.prompt).toBe('use this key AKIA…(len 20) please')
  })

  it('drops a client-supplied redaction or pruned marker', async () => {
    await postToolUse(
      req('post-tool-use', {
        session_id: 'sess_1',
        tool_name: 'Bash',
        _lumo_redaction: { count: 0 },
        _lumo_pruned: { at: '2020-01-01', reason: 'RETENTION_POLICY' },
      })
    )
    const stored = mockRecord.mock.calls[0][0].payload
    expect(stored._lumo_redaction).toBeUndefined()
    expect(stored._lumo_pruned).toBeUndefined()
  })
})
