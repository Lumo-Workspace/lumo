import { redactHookPayload } from '@/lib/validation/hook-payload'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { MAX_SCANNED_LINE_CHARS } from '@/lib/security-scan'

const AWS_KEY = 'AKIA' + 'Q3ZT7XW2PL9MN4RB'

describe('redactHookPayload (LUM-859)', () => {
  it('leaves a secret-free payload byte-identical', () => {
    const payload = {
      session_id: 'sess_1',
      tool_name: 'Edit',
      tool_input: {
        file_path: 'lib/a.ts',
        old_string: 'const a = "ship it tomorrow"',
        new_string: 'const a = "ship it today"',
      },
      tool_response: [{ type: 'text', text: 'ok' }, 42, null, true],
      _lumo_usage: { model: 'x', input: 3 },
    }
    const before = JSON.stringify(payload)
    const result = redactHookPayload(payload)
    expect(result.payload).toBe(payload)
    expect(result.redactedCount).toBe(0)
    expect(JSON.stringify(result.payload)).toBe(before)
  })

  it('redacts nested strings without mutating the input', () => {
    const payload = {
      tool_input: { content: `line one\nkey=${AWS_KEY}\nline three` },
      tool_response: [`echo ${AWS_KEY}`],
    }
    const before = JSON.stringify(payload)
    const result = redactHookPayload(payload)
    expect(JSON.stringify(payload)).toBe(before)
    const out = result.payload as {
      tool_input: { content: string }
      tool_response: string[]
    }
    expect(out.tool_input.content).toBe(
      'line one\nkey=AKIA…(len 20)\nline three'
    )
    expect(out.tool_response[0]).toBe('echo AKIA…(len 20)')
    expect(result.redactedCount).toBe(2)
  })
})

describe('redactForStorage (LUM-859)', () => {
  it('scans an over-cap line whole instead of truncating it', () => {
    const filler = 'x'.repeat(MAX_SCANNED_LINE_CHARS * 3)
    // The key sits deep past the first window and straddles no content loss.
    const line = `${filler} ${AWS_KEY} ${filler}`
    const { text, redactedCount } = redactForStorage(line)
    expect(redactedCount).toBe(1)
    expect(text).not.toContain(AWS_KEY)
    expect(text).toBe(`${filler} AKIA…(len 20) ${filler}`)
  })

  it('catches a key that straddles a scan-window edge', () => {
    const head = 'x'.repeat(MAX_SCANNED_LINE_CHARS - 10)
    const line = `${head} ${AWS_KEY} ${'z'.repeat(MAX_SCANNED_LINE_CHARS)}`
    const { text } = redactForStorage(line)
    expect(text).not.toContain(AWS_KEY)
    expect(text.length).toBe(
      line.length - AWS_KEY.length + 'AKIA…(len 20)'.length
    )
  })

  it('returns an over-cap secret-free line unchanged', () => {
    const line = 'y '.repeat(MAX_SCANNED_LINE_CHARS)
    expect(redactForStorage(line).text).toBe(line)
  })
})
