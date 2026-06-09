/**
 * @jest-environment node
 *
 * LUM-335: the reconcile system prompts described ops in prose ("operation(s)")
 * and even ended with `Return { "operations": [...] }`, never showing the
 * literal `{"type":...}` per-element shape — actively priming the wrong key.
 * These tests pin that both prompts now show a literal `"type"` example and
 * explicitly forbid the `"operation"` key, plus the tightened UPDATE-vs-ADD
 * refinement-folding guidance.
 */
import { buildLayer1ReconcilePrompt } from '@/lib/services/memory/layer1-reconcile-prompt'
import { buildLayer2ReconcilePrompt } from '@/lib/services/memory/layer2-reconcile-prompt'

const layer1Input = {
  task: { title: 'T', description: null },
  candidates: [{ category: 'CONVENTION' as const, content: { rule: 'r' } }],
  neighborsByCandidate: [
    [{ id: 'mem_n', category: 'CONVENTION' as const, content: { rule: 'r0' }, score: 0.8 }],
  ],
}

const layer2Input = {
  project: { id: 'p1', name: 'P' },
  candidates: [{ category: 'CONVENTION' as const, content: { rule: 'r' } }],
  neighborsByCandidate: [
    [{ id: 'pm_n', category: 'CONVENTION' as const, content: { rule: 'r0' }, score: 0.7 }],
  ],
}

describe('buildLayer1ReconcilePrompt — literal type-keyed shape (LUM-335)', () => {
  it('shows a literal "type" op example', () => {
    const { system } = buildLayer1ReconcilePrompt(layer1Input)
    expect(system).toMatch(/"type":\s*"SUPERSEDE"/)
    expect(system).toMatch(/"type":\s*"NOOP"/)
  })

  it('explicitly tells the model to use "type" (not "operation") per element', () => {
    const { system } = buildLayer1ReconcilePrompt(layer1Input)
    expect(system).toMatch(/"type"/)
    expect(system).toMatch(/not\s+"operation"|never\s+"operation"|"operation"/)
    // The instruction must mention the wrong key by name so the model avoids it.
    expect(system).toContain('"operation"')
  })

  it('carries the refinement-folds-into-UPDATE guidance', () => {
    const { system } = buildLayer1ReconcilePrompt(layer1Input)
    expect(system).toMatch(/refin/i)
    expect(system).toContain('UPDATE')
  })
})

describe('buildLayer2ReconcilePrompt — literal type-keyed shape (LUM-335)', () => {
  it('shows a literal "type" op example', () => {
    const { system } = buildLayer2ReconcilePrompt(layer2Input)
    expect(system).toMatch(/"type":\s*"SUPERSEDE"/)
    expect(system).toMatch(/"type":\s*"NOOP"/)
  })

  it('explicitly tells the model to use "type" (not "operation") per element', () => {
    const { system } = buildLayer2ReconcilePrompt(layer2Input)
    expect(system).toContain('"operation"')
    expect(system).toMatch(/"type"/)
  })

  it('carries the refinement-folds-into-UPDATE guidance', () => {
    const { system } = buildLayer2ReconcilePrompt(layer2Input)
    expect(system).toMatch(/refin/i)
    expect(system).toContain('UPDATE')
  })
})
