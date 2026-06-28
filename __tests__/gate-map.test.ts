import {
  gateDefinition,
  provenanceForClass,
  ALL_GATE_KEYS,
  type GateKey,
} from '../shared/src/gate-map'

describe('gate-map', () => {
  it('classifies provenance by class', () => {
    // Detection-class gates are derived server-side by Lumo from the payload
    // stream it already ingests — genuinely independent of the agent.
    for (const key of ['diff-scope', 'git-hygiene'] as GateKey[]) {
      const def = gateDefinition(key)
      expect(def.class).toBe('detection')
      expect(def.provenance).toBe('independent_harness')
    }

    // Execution-class gates ride on the agent's own tool runs — the agent chose
    // to run them and could skip them, so they are self-reported, not independent.
    for (const key of ['parse', 'typecheck', 'build', 'test'] as GateKey[]) {
      const def = gateDefinition(key)
      expect(def.class).toBe('execution')
      expect(def.provenance).toBe('agent_self_reported')
    }

    // Provenance is a pure function of class — never assigned ad hoc per gate,
    // so a future gate can't silently land in the wrong trust bucket.
    expect(provenanceForClass('detection')).toBe('independent_harness')
    expect(provenanceForClass('execution')).toBe('agent_self_reported')
  })

  it('covers every gate key with a single definition', () => {
    for (const key of ALL_GATE_KEYS) {
      expect(gateDefinition(key).key).toBe(key)
    }
  })
})
