/**
 * @jest-environment node
 */
import { resolveAgentToken } from '@/cli/src/commands/init'

describe('resolveAgentToken', () => {
  it('defaults to claude-code when no token is supplied', () => {
    expect(resolveAgentToken(undefined)).toEqual({ token: 'claude-code' })
  })

  it('canonicalizes a recognized token', () => {
    expect(resolveAgentToken('codex')).toEqual({ token: 'codex' })
  })

  it('canonicalizes an alias to its canonical token', () => {
    expect(resolveAgentToken('gemini')).toEqual({ token: 'gemini-cli' })
    expect(resolveAgentToken('copilot')).toEqual({ token: 'github-copilot' })
  })

  it('is case-insensitive', () => {
    expect(resolveAgentToken('Claude-Code')).toEqual({ token: 'claude-code' })
  })

  it('returns an error for an unrecognized token', () => {
    const result = resolveAgentToken('not-an-agent')
    expect('error' in result).toBe(true)
  })
})
