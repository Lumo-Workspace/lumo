/** @jest-environment node */
import {
  normalizeAgent,
  AGENT_LABELS,
  VALID_AGENT_TOKENS,
} from '@/cli/src/lib/agent'

describe('normalizeAgent', () => {
  it('maps canonical tokens to enum values', () => {
    expect(normalizeAgent('claude-code')).toBe('CLAUDE_CODE')
    expect(normalizeAgent('codex')).toBe('CODEX')
    expect(normalizeAgent('cursor')).toBe('CURSOR')
    expect(normalizeAgent('gemini-cli')).toBe('GEMINI_CLI')
    expect(normalizeAgent('github-copilot')).toBe('GITHUB_COPILOT')
    expect(normalizeAgent('windsurf')).toBe('WINDSURF')
  })
  it('accepts aliases and is case/space insensitive', () => {
    expect(normalizeAgent('Gemini')).toBe('GEMINI_CLI')
    expect(normalizeAgent('Copilot')).toBe('GITHUB_COPILOT')
    expect(normalizeAgent('Claude Code')).toBe('CLAUDE_CODE')
  })
  it('returns null for unknown tokens', () => {
    expect(normalizeAgent('devin')).toBeNull()
    expect(normalizeAgent('')).toBeNull()
  })
  it('exposes labels and a sorted token hint', () => {
    expect(AGENT_LABELS.CODEX).toBe('Codex')
    expect(VALID_AGENT_TOKENS).toContain('claude-code')
  })
})
