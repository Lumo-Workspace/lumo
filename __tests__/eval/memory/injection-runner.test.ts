import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyFollowed,
  scoreInjectionRun,
  type InjectionResult,
} from '@/scripts/eval/memory/injection-runner'

const mk = (
  id: string,
  kind: InjectionResult['kind'],
  followed: InjectionResult['followed']
): InjectionResult => ({ id, kind, followed })

describe('scoreInjectionRun reports conflict-win and reinforce-adoption rates LUM-393', () => {
  const results: InjectionResult[] = [
    mk('cf1', 'CONFLICT', 'INSTRUCTION'), // memory yielded → win
    mk('cf2', 'CONFLICT', 'MEMORY'), // memory over-influenced → loss
    mk('cf3', 'CONFLICT', 'INSTRUCTION'), // win
    mk('rf1', 'REINFORCE', 'MEMORY'), // memory adopted (uncontested)
    mk('rf2', 'REINFORCE', 'NEITHER'), // memory not adopted → over-correction
  ]

  it('conflict-win rate = 2/3 — the current instruction wins, memory yields', () => {
    expect(scoreInjectionRun(results).conflictWinRate).toBeCloseTo(2 / 3)
  })

  it('reinforce-adoption rate = 1/2 — memory still used when uncontested', () => {
    expect(scoreInjectionRun(results).reinforceAdoptionRate).toBeCloseTo(0.5)
  })

  it('reports per-kind counts and n', () => {
    const s = scoreInjectionRun(results)
    expect(s.n).toBe(5)
    expect(s.nConflict).toBe(3)
    expect(s.nReinforce).toBe(2)
  })

  it('empty run scores 0 without dividing by zero', () => {
    const s = scoreInjectionRun([])
    expect(s.conflictWinRate).toBe(0)
    expect(s.reinforceAdoptionRate).toBe(0)
    expect(s.n).toBe(0)
  })
})

describe('classifyFollowed maps a free-text answer to the source it followed LUM-393', () => {
  const conflict = {
    kind: 'CONFLICT' as const,
    instructionMarker: 'npm',
    memoryMarker: 'yarn',
  }
  const reinforce = {
    kind: 'REINFORCE' as const,
    instructionMarker: '',
    memoryMarker: '__tests__',
  }

  it('CONFLICT: instruction marker only → INSTRUCTION (memory yielded)', () => {
    expect(classifyFollowed('Run `npm install left-pad`.', conflict)).toBe(
      'INSTRUCTION'
    )
  })

  it('CONFLICT: memory marker only → MEMORY (over-influenced)', () => {
    expect(classifyFollowed('Use `yarn add left-pad`.', conflict)).toBe(
      'MEMORY'
    )
  })

  it('CONFLICT: both markers present is ambiguous → NEITHER', () => {
    expect(classifyFollowed('You could use npm or yarn.', conflict)).toBe(
      'NEITHER'
    )
  })

  it('CONFLICT: matching is case-insensitive', () => {
    expect(classifyFollowed('Run NPM install.', conflict)).toBe('INSTRUCTION')
  })

  it('REINFORCE: memory marker present → MEMORY (adopted)', () => {
    expect(
      classifyFollowed('Put it in the __tests__ directory.', reinforce)
    ).toBe('MEMORY')
  })

  it('REINFORCE: memory marker absent → NEITHER (over-correction)', () => {
    expect(classifyFollowed('Put it anywhere you like.', reinforce)).toBe(
      'NEITHER'
    )
  })
})

describe('injection-runner keeps the gateway out of the jest bundle LUM-393', () => {
  it('imports the LLM gateway dynamically, never as a static top-level import', () => {
    const src = readFileSync(
      join(process.cwd(), 'scripts/eval/memory/injection-runner.ts'),
      'utf8'
    )
    // The live step must use a dynamic import so importing the scorer never
    // pulls @ai-sdk/gateway / generateText into the test bundle (sf-runner trap).
    expect(src).toMatch(/await import\(/)
    expect(src).not.toMatch(/^import .*@ai-sdk/m)
  })
})
