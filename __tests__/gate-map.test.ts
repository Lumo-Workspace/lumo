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
    expect(classifyCommand('tsc --noEmit')).toEqual(['typecheck'])
    expect(classifyCommand('cd /x && npx tsc --noEmit')).toEqual(['typecheck'])
    expect(classifyCommand('npx jest foo.test.ts')).toEqual(['test'])
    expect(classifyCommand('npm test')).toEqual(['test'])
    expect(classifyCommand('cd /x && npm run build')).toEqual(['build'])
    // 'parse' gate was removed (LUM-616 follow-up) — node --check no longer maps.
    expect(classifyCommand('node --check foo.js')).toEqual([])
  })

  it('splits a merged multi-gate command into every matched gate', () => {
    // LUM-629 (observed on LUM-620 #770): jest and tsc written as one shell
    // command used to classify as typecheck only, so the test gate sat at
    // not_run even though jest ran and passed inside the delivery window.
    // Every matched gate is returned, in declaration order.
    expect(
      classifyCommand('npx jest __tests__/x.test.ts; npx tsc --noEmit')
    ).toEqual(['typecheck', 'test'])
    expect(classifyCommand('npx tsc --noEmit && npm run build')).toEqual([
      'typecheck',
      'build',
    ])
    expect(
      classifyCommand('npx jest a.test.ts && npx tsc --noEmit && npm run build')
    ).toEqual(['typecheck', 'build', 'test'])
    // A single-gate command still yields exactly one signal.
    expect(classifyCommand('npx tsc --noEmit')).toEqual(['typecheck'])
  })

  it('does NOT classify gate keywords that only appear inside quoted text', () => {
    // The LUM-614 prod bug: a `lumo task create` whose description discusses
    // gates ("parse/typecheck/build/test") was misclassified as a passed
    // typecheck, overwriting the real `tsc` signal with garbage grounding.
    expect(
      classifyCommand(
        'lumo task create "机械门闸:执行类 gate(parse/typecheck/build/test)" --new-scope'
      )
    ).toEqual([])
    // A diagnostic echo that merely mentions "test" is not a test run.
    expect(
      classifyCommand(
        'echo "===run same test on main===" && git branch --show-current'
      )
    ).toEqual([])
    // git/echo/cat that merely name a build/test path are not gate runs.
    expect(classifyCommand("git commit -m 'fix build'")).toEqual([])
    expect(classifyCommand('cat package.json | grep test')).toEqual([])
    // Multi-gate splitting only applies to unquoted invocation tokens: a real
    // jest run whose quoted arg mentions tsc is a test run, not a typecheck.
    expect(
      classifyCommand('npx jest x.test.ts -t "tsc build test regression"')
    ).toEqual(['test'])
  })

  it('still classifies a real gate run buried after a cd/env prefix', () => {
    expect(classifyCommand('cd /repo && npx jest __tests__/x.test.ts')).toEqual(
      ['test']
    )
  })
})
