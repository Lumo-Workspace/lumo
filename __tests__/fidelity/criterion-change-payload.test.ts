/**
 * LUM-707 item 1 — "how to read a CRITERION_CHANGED payload" is ONE decision,
 * so it gets one implementation.
 *
 * LUM-497 held this line for the numbers (`independenceSignal` is imported by
 * the reference-class anchor, never reimplemented, so the anchor and `lumo
 * fidelity show` cannot report different figures) and then broke it for the
 * adapter: `reference-class.service.ts` and `fidelity-change-pattern.service.ts`
 * each carried a verbatim copy of the payload reader, and only one of them was
 * covered by a test. The copies encode real decisions — which ops count, that a
 * missing `round` means 0, that a non-string `criterionId` is unreadable — so
 * adding a payload field or renaming `round` had to be remembered in two files.
 *
 * These tests pin both halves: the shared reader's behaviour, and the absence
 * of a second copy.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { criterionChangeFromPayload } from '@/lib/fidelity/change-pattern'

const AT = new Date('2026-06-20T10:00:00.000Z')

const CONSUMERS = [
  'lib/services/reference-class.service.ts',
  'lib/services/fidelity-change-pattern.service.ts',
]

// Anchored on this file's own location, not on cwd: the checkpointer runs from
// wherever `lumo verify` is invoked, and a worktree checkout is a different root
// than the main one.
const REPO_ROOT = join(__dirname, '..', '..')

function sourceOf(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8')
}

describe('shared payload reader', () => {
  it('reads the mechanical fields off a well-formed payload', () => {
    expect(
      criterionChangeFromPayload(
        {
          op: 'UPDATED',
          criterionId: 'c1',
          source: 'HUMAN_EDIT',
          round: 2,
          causeTag: 'SCOPE_CHANGE',
          before: { statement: 'old' },
          after: { statement: 'new' },
        },
        AT
      )
    ).toEqual({
      op: 'UPDATED',
      criterionId: 'c1',
      round: 2,
      causeTag: 'SCOPE_CHANGE',
      at: AT,
    })
  })

  // Payloads are freeform stored JSON that older code paths also wrote, so a
  // row can be null, a bare string, or an object with the wrong shape. Every
  // one of those must be skipped rather than thrown on — a single bad row in a
  // 50-task reference class would otherwise take the whole anchor down.
  it.each([
    ['null payload', null],
    ['undefined payload', undefined],
    ['non-object payload', 'not-json'],
    ['op outside the enum', { op: 'RENAMED', criterionId: 'c1', round: 1 }],
    ['missing op', { criterionId: 'c1', round: 1 }],
    ['criterionId not a string', { op: 'ADDED', criterionId: 42, round: 1 }],
  ])('returns null for an unreadable payload: %s', (_label, payload) => {
    expect(criterionChangeFromPayload(payload, AT)).toBeNull()
  })

  // The two defaults that make the difference between "a post-start edit" and
  // "an initial draft" downstream. A missing round must read as 0 (round-0
  // criteria are clean), never as a truthy post-start edit.
  it('defaults a missing or non-numeric round to 0 and a missing causeTag to null', () => {
    expect(
      criterionChangeFromPayload({ op: 'ADDED', criterionId: 'c1' }, AT)
    ).toMatchObject({ round: 0, causeTag: null })
    expect(
      criterionChangeFromPayload(
        { op: 'ADDED', criterionId: 'c1', round: '3', causeTag: 7 },
        AT
      )
    ).toMatchObject({ round: 0, causeTag: null })
  })

  it('keeps DELETED readable, leaving the policy on it to the caller', () => {
    expect(
      criterionChangeFromPayload(
        { op: 'DELETED', criterionId: 'c1', round: 1 },
        AT
      )
    ).toMatchObject({ op: 'DELETED' })
  })

  // The structural half. Asserted on the op-enum check rather than on a
  // function name, so it stays true however a future copy is spelled: any file
  // deciding for itself which ops are readable is a second implementation.
  it.each(CONSUMERS)(
    'is the only payload reader — %s decodes no payload of its own',
    relPath => {
      const src = sourceOf(relPath)
      expect(src).toContain('criterionChangeFromPayload')
      expect(src).not.toMatch(/op !== '(ADDED|UPDATED|DELETED)'/)
    }
  )
})
