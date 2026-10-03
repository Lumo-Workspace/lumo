/**
 * @jest-environment node
 *
 * LUM-863: the pure envelope primitives — KEK ring parsing, data-key
 * wrapping, sealed envelopes and their AAD binding.
 */
import {
  dataKeyAad,
  generateDataKey,
  openEnvelope,
  parseEnvelope,
  parseKekRing,
  sealString,
  unwrapDataKey,
  wrapDataKey,
} from '@/lib/envelope-crypto/cipher'
import { hookPayloadAad } from '@/lib/hook-event/payload-cipher'

// Test-only key material, assembled so it never reads as a literal secret.
const hexKey = (digit: string) => digit.repeat(64)
const ring = (...entries: [string, string][]) =>
  entries.map(([id, digit]) => id + ':' + hexKey(digit)).join(',')

describe('envelope cipher', () => {
  it('envelope cipher keeps workspaces apart and survives KEK rotation', () => {
    // KEK k1 wraps workspace A's key; the ring then rotates to k2 first.
    const [k1] = parseKekRing(ring(['k1', 'a']))
    const wrappedA = wrapDataKey(
      k1!,
      generateDataKey(),
      dataKeyAad('wsA', 'dA')
    )
    const rotated = parseKekRing(ring(['k2', 'b'], ['k1', 'a']))
    expect(rotated.map(k => k.id)).toEqual(['k2', 'k1'])
    const oldKek = rotated.find(k => k.id === 'k1')!
    const keyA = unwrapDataKey(oldKek, wrappedA, dataKeyAad('wsA', 'dA'))
    expect(keyA).toHaveLength(32)
    // The new primary KEK cannot open a key it did not wrap.
    expect(() =>
      unwrapDataKey(rotated[0]!, wrappedA, dataKeyAad('wsA', 'dA'))
    ).toThrow()
    // A wrapped key replayed under another workspace / key id fails the AAD.
    expect(() =>
      unwrapDataKey(oldKek, wrappedA, dataKeyAad('wsB', 'dA'))
    ).toThrow()

    // Each workspace's key is independent: B's key cannot open A's data.
    const keyB = generateDataKey()
    expect(keyB.equals(keyA)).toBe(false)
    const sealed = sealString('dA', keyA, '{"x":1}', hookPayloadAad('wsA'))
    const envelope = parseEnvelope(sealed)!
    expect(envelope.dataKeyId).toBe('dA')
    expect(sealed.startsWith('lenc:v1:dA:')).toBe(true)
    expect(sealed).not.toContain('"x"')
    expect(openEnvelope(envelope, keyA, hookPayloadAad('wsA'))).toBe('{"x":1}')
    expect(() => openEnvelope(envelope, keyB, hookPayloadAad('wsA'))).toThrow()
    // Same key, other workspace's AAD → rejected.
    expect(() => openEnvelope(envelope, keyA, hookPayloadAad('wsB'))).toThrow()

    // Tampering with one ciphertext byte is detected.
    const body = Buffer.from(envelope.body)
    body[14] = body[14]! ^ 0x01
    expect(() =>
      openEnvelope({ ...envelope, body }, keyA, hookPayloadAad('wsA'))
    ).toThrow()
  })

  it('treats an unset KEK ring as disabled and rejects malformed entries', () => {
    expect(parseKekRing(undefined)).toEqual([])
    expect(parseKekRing('  ')).toEqual([])
    expect(() => parseKekRing('k1:abc')).toThrow(/WORKSPACE_KEKS/)
    expect(() => parseKekRing(hexKey('a'))).toThrow(/WORKSPACE_KEKS/)
    expect(() => parseKekRing(ring(['k1', 'a'], ['k1', 'b']))).toThrow(/twice/)
  })

  it('parses only envelopes of its own format and version', () => {
    expect(parseEnvelope('lenc:v1:id:AAAA')).not.toBeNull()
    expect(parseEnvelope('lenc:v2:id:AAAA')).toBeNull()
    expect(parseEnvelope('plain text')).toBeNull()
    expect(parseEnvelope('lenc:v1::AAAA')).toBeNull()
  })
})
