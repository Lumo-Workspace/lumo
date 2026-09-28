/** @jest-environment node */
import { classifyRow, classifyStoredText, stringsOf } from '../classify'
import { redactSecret } from '@/lib/security-scan/redact'

const DASHES = '-'.repeat(5)
const header = `${DASHES}BEGIN RSA PRIVATE KEY${DASHES}`
const bodyLine = 'Qm7Tz4Lw9Kp2Xc8V'.repeat(4)

describe('LUM-887 stock classifier', () => {
  it('flags a body left behind the old header-only redaction', () => {
    const stored = `${redactSecret(header)}\n${bodyLine}\n${bodyLine}`
    expect([...classifyStoredText(stored)]).toContain('private-key-body')
    const escaped = `${redactSecret(header)}\\n${bodyLine}`
    expect([...classifyStoredText(escaped)]).toContain('private-key-body')
  })

  it('flags a raw block and the new rule shapes, by id only', () => {
    expect([...classifyStoredText(`${header}\n${bodyLine}`)]).toContain(
      'private-key-block'
    )
    const env = 'DB_PASSWORD=' + 'Qm7Tz4Lw' + '9Kp2'
    expect([...classifyStoredText(env)]).toEqual(['env-assignment'])
  })

  it('ignores text the old rules already handled and ordinary text', () => {
    expect(classifyStoredText('export GITHUB_TOKEN=$GH_TOKEN').size).toBe(0)
    expect(classifyStoredText(`${redactSecret(header)}\nnext line`).size).toBe(
      0
    )
  })

  it('walks nested JSON', () => {
    const payload = {
      tool_input: { command: ['PGPASSWORD=' + 'Qm7Tz4Lw9Kp2 psql'] },
    }
    expect(stringsOf(payload)).toHaveLength(1)
    expect([...classifyRow([payload, null])]).toEqual(['env-assignment'])
  })
})
