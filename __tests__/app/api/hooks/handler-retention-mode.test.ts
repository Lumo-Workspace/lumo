/**
 * @jest-environment node
 *
 * LUM-933 — what the hook handler stores depends on the workspace's session
 * record mode. RETAIN (the default) keeps code, file content and command
 * output; USED_UP strips them on ingest (LUM-855). Credentials are redacted
 * in every mode, and a mode that cannot be read falls back to stripping.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findHookEventRetentionMode: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { hookIngestPolicyService } from '@/lib/services/hook-ingest-policy.service'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock
const mockMode = workspaceRepository.findHookEventRetentionMode as jest.Mock

const identity = {
  user: { id: 'clerk_1' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

const CODE =
  'export function charge(amount: number) {\n  return amount * 2\n}\n'
// Built at runtime so no credential-shaped literal sits in the source.
const TOKEN = ['gh', 'p_', 'Zq8Lm2Vx'.repeat(4), 'Ab12'].join('')
const OUTPUT = `deploying with ${TOKEN}\nall 12 tests passed`

function writeEvent() {
  return {
    session_id: 'sess_1',
    tool_name: 'Write',
    tool_input: { file_path: '/repo/lib/billing.ts', content: CODE },
    tool_response: { filePath: '/repo/lib/billing.ts', success: true },
  }
}

function bashEvent() {
  return {
    session_id: 'sess_1',
    tool_name: 'Bash',
    tool_input: { command: 'npm run deploy' },
    tool_response: { stdout: OUTPUT, stderr: '' },
  }
}

function post(body: unknown) {
  return new Request('http://x/api/hooks/post-tool-use', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

async function stored(body: unknown) {
  mockRecord.mockClear()
  const res = await handleHookRequest(post(body), 'POST_TOOL_USE')
  expect(res.status).toBe(200)
  return mockRecord.mock.calls[0][0].payload as Record<string, any>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
  mockRecord.mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: null,
    toolName: 'Write',
    filePath: '/repo/lib/billing.ts',
  })
})

describe('hook ingest by session record mode', () => {
  it('retain mode stores code but still redacts credentials', async () => {
    mockMode.mockResolvedValue('RETAIN')
    const write = await stored(writeEvent())
    expect(write.tool_input.content).toBe(CODE)

    const bash = await stored(bashEvent())
    const stdout = bash.tool_response.stdout as string
    expect(stdout).toContain('all 12 tests passed')
    expect(stdout).not.toContain(TOKEN)
    expect(JSON.stringify(bash)).not.toContain(TOKEN)
    expect(mockMode).toHaveBeenCalledWith('ws_1')
  })

  it('used-up mode and a failed mode lookup both strip code on ingest', async () => {
    mockMode.mockResolvedValue('USED_UP')
    const usedUp = await stored(writeEvent())
    expect(usedUp.tool_input.content).toBeUndefined()
    expect(JSON.stringify(usedUp)).not.toContain('amount * 2')

    mockMode.mockRejectedValue(new Error('db down'))
    const failed = await stored(bashEvent())
    expect(JSON.stringify(failed)).not.toContain('all 12 tests passed')
    expect(JSON.stringify(failed)).not.toContain(TOKEN)

    // A workspace row that is gone reads as "unknown" too.
    mockMode.mockResolvedValue(null)
    const gone = await stored(writeEvent())
    expect(gone.tool_input.content).toBeUndefined()
  })
})

describe('hookIngestPolicyService.storedPayloadFor', () => {
  it('returns the redacted payload untouched for RETAIN', async () => {
    mockMode.mockResolvedValue('RETAIN')
    const payload = { tool_input: { file_path: '/a.ts', content: CODE } }
    await expect(
      hookIngestPolicyService.storedPayloadFor('ws_1', 'POST_TOOL_USE', payload)
    ).resolves.toBe(payload)
  })
})
