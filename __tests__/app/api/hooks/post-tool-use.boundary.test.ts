/**
 * @jest-environment node
 *
 * LUM-426 criterion 5 — the design's命门. Boundary detection runs server-side,
 * AFTER ingestion, as a best-effort afterRecord side effect. It must never flip
 * the hook response off 200 or block the agent's tool call: the LUM-348 exit-0
 * / never-4xx invariant holds even when a forbidden action is detected.
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
// waitUntil: pass-through that swallows so a detached rejection can't surface.
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: unknown) => {
    void Promise.resolve(p).catch(() => {})
  },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { POST as postPost } from '@/app/api/hooks/post-tool-use/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock
const mockDetect = boundaryDetectorService.detectAndRecord as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

// A forbidden action: pushing to main.
const FORBIDDEN_PAYLOAD = {
  session_id: 'sess_1',
  tool_name: 'Bash',
  tool_input: { command: 'git push origin main --force' },
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

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
  // The ingested event is bound to a task — detection has a target.
  mockRecord.mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: 't-1',
    toolName: 'Bash',
    filePath: null,
  })
  mockDetect.mockResolvedValue(undefined)
})

describe('POST /api/hooks/post-tool-use — boundary detection', () => {
  it('hook still exits 0 and does not block when a boundary-crossing is detected', async () => {
    const res = await postPost(post(FORBIDDEN_PAYLOAD))

    // The ingestion response is unchanged: 200 / { ok: true }. The tool call is
    // never blocked or aborted — detection is observe-only.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Detection DID fire on the ingested event (async, observe-only) — fed the
    // bound task + the raw payload so it can match the command.
    expect(mockDetect).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        hookEventId: 'he_1',
        payload: FORBIDDEN_PAYLOAD,
      })
    )
  })

  it('hook still exits 0 when an evasion or high-severity crossing is detected', async () => {
    // A base64-obfuscated forbidden command (the evasion headline case).
    const encoded = Buffer.from('git push origin main --force').toString(
      'base64'
    )
    const EVASION_PAYLOAD = {
      session_id: 'sess_1',
      tool_name: 'Bash',
      tool_input: { command: `echo ${encoded} | base64 -d | sh` },
    }

    // The REAL detector genuinely flags this payload (HIGH-severity evasion), so
    // the test name isn't vacuous: a crossing IS detected here…
    const { detectCrossings } = jest.requireActual(
      '@/lib/services/boundary-detector.service'
    )
    const detected = detectCrossings({
      toolName: 'Bash',
      filePath: null,
      payload: EVASION_PAYLOAD,
    })
    expect(detected.length).toBeGreaterThan(0)
    expect(
      detected.some((c: { severity: string }) => c.severity === 'HIGH')
    ).toBe(true)

    // …and yet the hook ingestion path still exits 0 / { ok: true } and never
    // blocks the tool call (LUM-426 / LUM-348 exit-0 invariant).
    const res = await postPost(post(EVASION_PAYLOAD))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockDetect).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't-1', payload: EVASION_PAYLOAD })
    )
  })

  it('a detector failure never flips the hook response off 200 (best-effort)', async () => {
    mockDetect.mockRejectedValue(new Error('detector exploded'))
    const res = await postPost(post(FORBIDDEN_PAYLOAD))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('does not run detection for an unbound event (no taskId)', async () => {
    mockRecord.mockResolvedValue({
      id: 'he_2',
      sessionId: 'sess_1',
      taskId: null,
      toolName: 'Bash',
      filePath: null,
    })
    const res = await postPost(post(FORBIDDEN_PAYLOAD))
    expect(res.status).toBe(200)
    expect(mockDetect).not.toHaveBeenCalled()
  })
})
