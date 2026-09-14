/**
 * @jest-environment node
 *
 * LUM-778 — a manual-add rejection must state the REAL reason. Every
 * ScreenReason maps to its own message, and a CONSTITUTION_REDUNDANT rejection
 * quotes the constitution line it matched and names the repo that line was
 * read from, so the user can open the file and check the claim.
 */
import {
  SCREEN_REASONS,
  screenCandidate,
  type ScreenFailure,
} from '@/lib/services/memory/extraction-gate'
import { formatScreenRejection } from '@/lib/services/memory/screen-rejection'

const CONSTITUTION = [
  '# CLAUDE.md',
  '## Code Style',
  '- Use async/await, not .then()',
  '- Use Prisma for all database access — never raw SQL',
].join('\n')

function failureFor(reason: (typeof SCREEN_REASONS)[number]): ScreenFailure {
  switch (reason) {
    case 'INCOMPLETE_FACT':
      return { ok: false, reason }
    case 'CONSTITUTION_REDUNDANT':
      return {
        ok: false,
        reason,
        matchedLine: 'Use Prisma for all database access — never raw SQL',
      }
  }
}

describe('ScreenReason → rejection message mapping (LUM-778)', () => {
  it('every ScreenReason maps to a distinct message that names its own cause', () => {
    const messages = SCREEN_REASONS.map(reason =>
      formatScreenRejection(failureFor(reason), 'acme/app')
    )
    expect(new Set(messages).size).toBe(SCREEN_REASONS.length)
    expect(SCREEN_REASONS).toEqual(
      expect.arrayContaining(['INCOMPLETE_FACT', 'CONSTITUTION_REDUNDANT'])
    )

    const incomplete = formatScreenRejection(
      failureFor('INCOMPLETE_FACT'),
      'acme/app'
    )
    expect(incomplete).toMatch(/incomplete fact/i)
    expect(incomplete).not.toMatch(/constitution|CLAUDE\.md/i)

    const redundant = formatScreenRejection(
      failureFor('CONSTITUTION_REDUNDANT'),
      'acme/app'
    )
    expect(redundant).toMatch(/constitution/i)
    expect(redundant).toContain('acme/app')
    expect(redundant).toContain(
      'Use Prisma for all database access — never raw SQL'
    )
  })

  it('a CONSTITUTION_REDUNDANT ScreenReason carries the exact constitution line the gate matched', () => {
    const verdict = screenCandidate({
      category: 'CONVENTION',
      content: {
        rule: 'Use Prisma for all database access, never raw SQL',
        scope: 'all database code',
      },
      constitution: CONSTITUTION,
    })
    expect(verdict).toEqual({
      ok: false,
      reason: 'CONSTITUTION_REDUNDANT',
      matchedLine: 'Use Prisma for all database access — never raw SQL',
    })
  })

  it('an INCOMPLETE_FACT ScreenReason never claims constitution redundancy, even when the constitution is loaded', () => {
    const verdict = screenCandidate({
      category: 'TRAP',
      content: { trigger: 'taskId mismatch' },
      constitution: CONSTITUTION,
    })
    expect(verdict).toEqual({ ok: false, reason: 'INCOMPLETE_FACT' })
  })

  it('a long matched line is clipped in the ScreenReason message but still identifiable', () => {
    const long = 'x'.repeat(400)
    const msg = formatScreenRejection(
      { ok: false, reason: 'CONSTITUTION_REDUNDANT', matchedLine: long },
      'acme/app'
    )
    expect(msg.length).toBeLessThan(400)
    expect(msg).toContain('x'.repeat(100))
    expect(msg).toContain('…')
  })
})
