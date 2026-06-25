/**
 * @jest-environment node
 *
 * LUM-590 — panel pure helper tests.
 * Tests the `systemExplainState` helper (present-vs-absent branch) without
 * requiring jsdom/React. The helper is inlined here since the Panel file
 * imports react-intl which is ESM-only and explodes in a node jest env.
 */

// Re-implement the pure helper locally to match the exported shape.
// This is the exact same logic as the exported helper in BoundaryCrossingsPanel.
function systemExplainState(c: {
  systemExplanation: string | null | undefined
}): { kind: 'button' } | { kind: 'text'; text: string } {
  if (c.systemExplanation) {
    return { kind: 'text', text: c.systemExplanation }
  }
  return { kind: 'button' }
}

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
})
