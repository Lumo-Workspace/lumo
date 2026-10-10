/**
 * @jest-environment node
 *
 * LUM-1080 — Slack request signature check and Content-Type-aware parsing.
 */
import { createHmac } from 'crypto'
import {
  parseSlackRequestBody,
  verifySlackSignature,
} from '@/lib/integrations/slack/request'

const SECRET = 'test-signing-secret'
const NOW = 1_700_000_000

function sign(body: string, ts: number | string, secret = SECRET) {
  return (
    'v0=' +
    createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
  )
}

describe('verifySlackSignature', () => {
  const body = 'command=%2Flumo&text=status+LUM-1'

  it('accepts a correct signature over the raw body', () => {
    expect(
      verifySlackSignature(body, sign(body, NOW), String(NOW), SECRET, NOW)
    ).toBe(true)
  })

  it('rejects a body changed after signing', () => {
    expect(
      verifySlackSignature(
        body + '&x=1',
        sign(body, NOW),
        String(NOW),
        SECRET,
        NOW
      )
    ).toBe(false)
  })

  it('rejects a wrong secret, a stale timestamp and a malformed timestamp', () => {
    expect(
      verifySlackSignature(
        body,
        sign(body, NOW, 'other'),
        String(NOW),
        SECRET,
        NOW
      )
    ).toBe(false)
    const old = NOW - 301
    expect(
      verifySlackSignature(body, sign(body, old), String(old), SECRET, NOW)
    ).toBe(false)
    expect(verifySlackSignature(body, sign(body, ''), '', SECRET, NOW)).toBe(
      false
    )
  })

  it('rejects when the signing secret or signature is empty', () => {
    expect(
      verifySlackSignature(body, sign(body, NOW, ''), String(NOW), '', NOW)
    ).toBe(false)
    expect(verifySlackSignature(body, '', String(NOW), SECRET, NOW)).toBe(false)
  })
})

describe('parseSlackRequestBody', () => {
  it('parses a form-encoded slash command into its fields', () => {
    const raw = new URLSearchParams({
      command: '/lumo',
      text: 'status LUM-12',
      team_id: 'T1',
      response_url: 'https://hooks.slack.com/commands/x',
    }).toString()
    expect(
      parseSlackRequestBody(
        raw,
        'application/x-www-form-urlencoded; charset=utf-8'
      )
    ).toEqual({
      command: '/lumo',
      text: 'status LUM-12',
      team_id: 'T1',
      response_url: 'https://hooks.slack.com/commands/x',
    })
  })

  it('unwraps an interactive payload= form field', () => {
    const raw = new URLSearchParams({
      payload: JSON.stringify({ type: 'block_actions', team: { id: 'T1' } }),
    }).toString()
    expect(
      parseSlackRequestBody(raw, 'application/x-www-form-urlencoded')
    ).toEqual({ type: 'block_actions', team: { id: 'T1' } })
  })

  it('parses JSON events', () => {
    expect(
      parseSlackRequestBody(
        JSON.stringify({ type: 'url_verification', challenge: 'c' }),
        'application/json'
      )
    ).toEqual({ type: 'url_verification', challenge: 'c' })
  })

  it('returns null for unparseable or non-object bodies', () => {
    expect(parseSlackRequestBody('command=/lumo', 'application/json')).toBe(
      null
    )
    expect(parseSlackRequestBody('[1]', 'application/json')).toBe(null)
    expect(
      parseSlackRequestBody(
        'payload=%7Bbad',
        'application/x-www-form-urlencoded'
      )
    ).toBe(null)
  })
})
