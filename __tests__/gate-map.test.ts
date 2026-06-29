import {
  gateDefinition,
  provenanceForClass,
  classifyCommand,
  ALL_GATE_KEYS,
  type GateKey,
} from '../shared/src/gate-map'

describe('gate-map', () => {
  it('classifies provenance by class', () => {
    // All gate keys today are execution-class (detection gates removed — LUM-616
    // f/u). They ride on the agent's own tool runs OR an independent CI run; the
    // class default (used for not-run/not-configured rows) is self-reported.
    for (const key of ['typecheck', 'build', 'test'] as GateKey[]) {
      const def = gateDefinition(key)
      expect(def.class).toBe('execution')
      expect(def.provenance).toBe('agent_self_reported')
    }

    // Provenance-by-class is the class-default mapping (the 'detection' branch is
    // kept as scaffolding for a future re-added detection gate).
    expect(provenanceForClass('detection')).toBe('independent_harness')
    expect(provenanceForClass('execution')).toBe('agent_self_reported')
  })

  it('covers every gate key with a single definition', () => {
    for (const key of ALL_GATE_KEYS) {
      expect(gateDefinition(key).key).toBe(key)
    }
  })
})

describe('classifyCommand', () => {
  it('classifies real gate invocations', () => {
    expect(classifyCommand('tsc --noEmit')).toBe('typecheck')
    expect(classifyCommand('cd /x && npx tsc --noEmit')).toBe('typecheck')
    expect(classifyCommand('npx jest foo.test.ts')).toBe('test')
    expect(classifyCommand('npm test')).toBe('test')
    expect(classifyCommand('cd /x && npm run build')).toBe('build')
    // 'parse' gate was removed (LUM-616 follow-up) — node --check no longer maps.
    expect(classifyCommand('node --check foo.js')).toBeNull()
  })

  it('does NOT classify gate keywords that only appear inside quoted text', () => {
    // The LUM-614 prod bug: a `lumo task create` whose description discusses
    // gates ("parse/typecheck/build/test") was misclassified as a passed
    // typecheck, overwriting the real `tsc` signal with garbage grounding.
    expect(
      classifyCommand(
        'lumo task create "机械门闸:执行类 gate(parse/typecheck/build/test)" --new-scope'
      )
    ).toBeNull()
    // A diagnostic echo that merely mentions "test" is not a test run.
    expect(
      classifyCommand(
        'echo "===run same test on main===" && git branch --show-current'
      )
    ).toBeNull()
    // git/echo/cat that merely name a build/test path are not gate runs.
    expect(classifyCommand("git commit -m 'fix build'")).toBeNull()
    expect(classifyCommand('cat package.json | grep test')).toBeNull()
  })

  it('still classifies a real gate run buried after a cd/env prefix', () => {
    expect(classifyCommand('cd /repo && npx jest __tests__/x.test.ts')).toBe(
      'test'
    )
  })
})
