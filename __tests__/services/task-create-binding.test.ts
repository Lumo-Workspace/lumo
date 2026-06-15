/** @jest-environment node */
import { classifyTaskCreateIntent } from '@/lib/services/task-create-binding'

const boundInReview = {
  identifier: 'LUM-7',
  title: 'Build the widget',
  status: 'IN_REVIEW' as const,
}
const boundInProgress = { ...boundInReview, status: 'IN_PROGRESS' as const }
const boundTodo = { ...boundInReview, status: 'TODO' as const }
const boundDone = { ...boundInReview, status: 'DONE' as const }

describe('classifyTaskCreateIntent', () => {
  it('redirects when --rework-of is declared (regardless of binding)', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: null,
        reworkOf: 'LUM-7',
        newScope: false,
      })
    ).toEqual({ kind: 'redirect-rework', target: 'LUM-7' })
  })

  it('forces a declaration when bound to an in-flight task and no flag', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInReview,
        reworkOf: undefined,
        newScope: false,
      })
    ).toEqual({
      kind: 'must-declare',
      boundIdentifier: 'LUM-7',
      boundTitle: 'Build the widget',
    })
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInProgress,
        reworkOf: undefined,
        newScope: false,
      }).kind
    ).toBe('must-declare')
  })

  it('allows when --new-scope is declared', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInReview,
        reworkOf: undefined,
        newScope: true,
      })
    ).toEqual({ kind: 'allow' })
  })

  it('allows when not bound, or bound to a non-in-flight task', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: null,
        reworkOf: undefined,
        newScope: false,
      })
    ).toEqual({ kind: 'allow' })
    expect(
      classifyTaskCreateIntent({
        boundTask: boundTodo,
        reworkOf: undefined,
        newScope: false,
      }).kind
    ).toBe('allow')
    expect(
      classifyTaskCreateIntent({
        boundTask: boundDone,
        reworkOf: undefined,
        newScope: false,
      }).kind
    ).toBe('allow')
  })

  it('redirect takes precedence over an in-flight binding', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInReview,
        reworkOf: 'LUM-99',
        newScope: false,
      })
    ).toEqual({ kind: 'redirect-rework', target: 'LUM-99' })
  })
})

describe('classifyTaskCreateIntent — open send-back (Phase 2)', () => {
  it('blocks when the bound in-flight task has an open send-back, even with --new-scope', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInProgress,
        boundTaskHasOpenSendBack: true,
        reworkOf: undefined,
        newScope: true,
      })
    ).toEqual({
      kind: 'blocked-open-sendback',
      boundIdentifier: 'LUM-7',
      boundTitle: 'Build the widget',
    })
  })

  it('blocks open-send-back even with no flag (precedence over must-declare)', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInReview,
        boundTaskHasOpenSendBack: true,
        reworkOf: undefined,
        newScope: false,
      }).kind
    ).toBe('blocked-open-sendback')
  })

  it('--rework-of still redirects even when an open send-back exists', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInProgress,
        boundTaskHasOpenSendBack: true,
        reworkOf: 'LUM-7',
        newScope: false,
      })
    ).toEqual({ kind: 'redirect-rework', target: 'LUM-7' })
  })

  it('no open send-back → unchanged Phase 1 behavior (--new-scope allowed)', () => {
    expect(
      classifyTaskCreateIntent({
        boundTask: boundInProgress,
        boundTaskHasOpenSendBack: false,
        reworkOf: undefined,
        newScope: true,
      })
    ).toEqual({ kind: 'allow' })
  })
})
