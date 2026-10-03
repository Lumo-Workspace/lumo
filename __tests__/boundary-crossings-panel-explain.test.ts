/**
 * @jest-environment node
 *
 * LUM-590 — panel pure helper tests.
 * Imports the REAL exported helper from boundary-explain.ts (not a local
 * re-implementation). The helper lives in a no-ESM-import file so it runs
 * cleanly in the node environment. The panel re-exports it as `systemExplainState`
 * so consumers only need one import path.
 */

import { systemExplainState } from '../app/workspace/[workspaceUrl]/components/TaskDetailTimeline/boundary-explain'

describe('systemExplainState (LUM-590)', () => {
  it('returns { kind: "button" } when systemExplanation is null', () => {
    expect(systemExplainState({ systemExplanation: null })).toEqual({
      kind: 'button',
    })
  })

  it('returns { kind: "button" } when systemExplanation is undefined', () => {
    expect(systemExplainState({ systemExplanation: undefined })).toEqual({
      kind: 'button',
    })
  })

  it('returns { kind: "button" } when systemExplanation is empty string', () => {
    // Empty string is falsy — treat as "not yet generated".
    expect(systemExplainState({ systemExplanation: '' })).toEqual({
      kind: 'button',
    })
  })

  it('returns { kind: "text", text } when systemExplanation is set', () => {
    expect(
      systemExplainState({
        systemExplanation: 'This looks like a false positive.',
      })
    ).toEqual({
      kind: 'text',
      text: 'This looks like a false positive.',
    })
  })

  it('returns the exact text without modification', () => {
    const text = 'Multi-line\nexplanation with "quotes" & <angle brackets>.'
    expect(systemExplainState({ systemExplanation: text })).toEqual({
      kind: 'text',
      text,
    })
  })

  it('returns { kind: "notRetained" } for a raw-purged crossing (LUM-912)', () => {
    expect(
      systemExplainState({ systemExplanation: 'cached', rawPurged: true })
    ).toEqual({ kind: 'notRetained' })
    expect(
      systemExplainState({ systemExplanation: null, rawPurged: false })
    ).toEqual({ kind: 'button' })
  })
})
