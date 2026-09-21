/**
 * @jest-environment node
 *
 * LUM-802 — a shell control-flow keyword is not a verb. `verbOf` reads the
 * first token of a segment, so `then echo "…"` used to classify as an unknown
 * verb (executing) while a bare `echo "…"` was dropped as a read-only carrier.
 * The built-in command matchers, unlike `matchActionRule`, do NOT strip quoted
 * literals — so the prose inside a `then`-prefixed echo reached them intact.
 *
 * The shape this hurts is the ordinary monitoring / guard script: its skeleton
 * is `if <bad thing>; then echo "<text describing the bad thing>"; fi`, and the
 * text describing the bad thing is exactly where the trigger words live. The
 * only backstop was the LUM-466 LLM confirmation, which fails closed — so the
 * cost was an LLM round-trip plus a possible HIGH false positive that blocks
 * DONE and that the agent cannot clear itself.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'
import type { BoundaryCrossingSeverity } from '@prisma/client'

const bash = (command: string) => ({
  toolName: 'Bash' as const,
  filePath: null,
  payload: { tool_input: { command } },
})
const cats = (command: string) =>
  detectCrossings(bash(command)).map(c => c.category)
const graded = (command: string): Array<[string, BoundaryCrossingSeverity]> =>
  detectCrossings(bash(command))
    .map(c => [c.category, c.severity] as [string, BoundaryCrossingSeverity])
    .sort()

/** The control-flow keywords that precede a full command. `done` / `fi` close
 *  a block and are followed by nothing, so they are not in this set. */
const PREFIXES = ['then', 'do', 'else', 'elif']

describe('command-shape control-flow prefixes (LUM-802)', () => {
  it('LUM-802: a control-flow-prefixed read-only carrier is still dropped', () => {
    // Non-vacuous: the prose trips the matcher when it is a real executing
    // segment, and is dropped when it is a bare carrier.
    expect(cats('psql -c "drop table users"')).toEqual([
      'DESTRUCTIVE_DB_COMMAND',
    ])
    expect(cats('echo "migration ran drop table users"')).toEqual([])

    for (const kw of PREFIXES) {
      expect(cats(`${kw} echo "migration ran drop table users"`)).toEqual([])
    }

    // The real-world shape: a monitor reporting on a bad thing it observed.
    expect(
      cats(
        `if [ "$state" = "bad" ]; then echo "migration ran drop table users"; fi`
      )
    ).toEqual([])
    expect(
      cats(`for i in $(seq 1 3); do echo "someone ran drop table users"; done`)
    ).toEqual([])
    // A carrier reached through a wrapper stays a carrier.
    expect(cats(`bash -c 'then echo "drop table users"'`)).toEqual([])
  })

  it('LUM-802: a control-flow-prefixed real action still reaches the matchers', () => {
    // Regression guard, green before and after the fix: skipping the keyword
    // must expose the REAL verb, never swallow the segment.
    const ACTIONS: Array<[string, string, BoundaryCrossingSeverity]> = [
      [
        'rm -rf prisma/migrations/20260101000000_x',
        'MIGRATION_FILE_DELETED',
        'MEDIUM',
      ],
      ['git push origin main', 'PUSH_TO_PROTECTED_BRANCH', 'MEDIUM'],
      ['pkill -f "next dev"', 'INFRA_TERMINATION', 'HIGH'],
      ['psql -c "drop table users"', 'DESTRUCTIVE_DB_COMMAND', 'HIGH'],
    ]

    for (const [action, category, severity] of ACTIONS) {
      expect(graded(action)).toContainEqual([category, severity])
      for (const kw of PREFIXES) {
        expect(graded(`${kw} ${action}`)).toContainEqual([category, severity])
      }
      // Inside the block shapes those keywords actually occur in.
      expect(graded(`if [ "$x" = "1" ]; then ${action}; fi`)).toContainEqual([
        category,
        severity,
      ])
      expect(graded(`for i in 1 2; do ${action}; done`)).toContainEqual([
        category,
        severity,
      ])
    }
  })
})
