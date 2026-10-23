/**
 * @jest-environment node
 *
 * LUM-1302 — the sealed at-rest form of a HookEvent payload.
 */
import { randomBytes } from 'crypto'
import {
  SEALED_PAYLOAD_KEY,
  isSealedPayload,
  openPayload,
  sealPayload,
  sealedKeyId,
  type DataKey,
} from '@/lib/hook-payload/seal'

const key = (id: string): DataKey => ({ id, key: randomBytes(32) })

describe('sealPayload / openPayload', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'cat src/secret-sauce.ts' },
    tool_response: { stdout: 'export const recipe = 42 // 中文' },
  }

  it('round-trips a payload and hides its text', () => {
    const k = key('dk_1')
    const sealed = sealPayload(payload, k)
    expect(Object.keys(sealed)).toEqual([SEALED_PAYLOAD_KEY])
    expect(JSON.stringify(sealed)).not.toContain('secret-sauce')
    expect(isSealedPayload(sealed)).toBe(true)
    expect(sealedKeyId(sealed)).toBe('dk_1')
    expect(openPayload(sealed, k)).toEqual(payload)
  })

  it('uses a fresh IV per seal', () => {
    const k = key('dk_1')
    expect(sealPayload(payload, k)).not.toEqual(sealPayload(payload, k))
  })

  it('refuses the wrong key, a relabelled key id and a tampered value', () => {
    const k = key('dk_1')
    const sealed = sealPayload(payload, k)
    expect(() => openPayload(sealed, key('dk_1'))).toThrow()
    // Same bytes under another id: the key id is authenticated data.
    const relabelled = {
      [SEALED_PAYLOAD_KEY]: sealed[SEALED_PAYLOAD_KEY].replace('dk_1', 'dk_2'),
    }
    expect(() => openPayload(relabelled, { id: 'dk_2', key: k.key })).toThrow()
    const parts = sealed[SEALED_PAYLOAD_KEY].split(':')
    parts[4] = Buffer.from('tampered').toString('base64url')
    expect(() =>
      openPayload({ [SEALED_PAYLOAD_KEY]: parts.join(':') }, k)
    ).toThrow()
  })
})

describe('isSealedPayload', () => {
  it('is false for plaintext payloads, including ones with an _enc field', () => {
    expect(isSealedPayload({ tool_name: 'Bash' })).toBe(false)
    expect(isSealedPayload(null)).toBe(false)
    expect(isSealedPayload([])).toBe(false)
    expect(isSealedPayload({ _enc: 'v1:x', other: 1 })).toBe(false)
    expect(isSealedPayload({ _enc: 'not-a-version' })).toBe(false)
    expect(isSealedPayload({ _enc: 42 })).toBe(false)
  })
})
