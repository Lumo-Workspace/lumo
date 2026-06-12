/**
 * LUM-463 criterion 4 — k-run consistency evaluation for the TEST_TAMPERING LLM
 * judge. The judge is non-deterministic, so before its verdict is trusted to
 * downgrade a crossing its reliability is MEASURED: run each labelled fixture k
 * times and record how often the k runs agree (pass^k discipline) and how often
 * the majority verdict matches the known label (accuracy). Pure orchestration —
 * the judge is injected, so the offline eval (real model) and the unit test
 * (mock) share one harness.
 */
import type {
  JudgeInput,
  JudgeVerdict,
  TamperingJudge,
} from './test-tampering-judge'

export interface ConsistencyFixture {
  name: string
  input: JudgeInput
  /** The ground-truth label for this diff. */
  expected: JudgeVerdict
}

export interface FixtureConsistency {
  name: string
  expected: JudgeVerdict
  runs: JudgeVerdict[]
  /** All k runs returned the same verdict. */
  unanimous: boolean
  /** The most frequent verdict across the k runs (ties → WEAKENING, the safe
   *  direction). */
  majority: JudgeVerdict
  /** Fraction of runs equal to the majority verdict (1 = unanimous). */
  agreement: number
  /** The majority verdict matched the fixture's known label. */
  matchedExpected: boolean
}

export interface ConsistencyReport {
  k: number
  fixtures: number
  perFixture: FixtureConsistency[]
  /** Fraction of fixtures whose k runs were unanimous — the pass^k headline. */
  unanimousRate: number
  /** Fraction of fixtures whose majority verdict matched the known label. */
  accuracy: number
}

function summarize(
  fixture: ConsistencyFixture,
  runs: JudgeVerdict[]
): FixtureConsistency {
  const legit = runs.filter(r => r === 'LEGIT').length
  const weakening = runs.length - legit
  // Ties resolve to WEAKENING (the conservative, flagging direction).
  const majority: JudgeVerdict = legit > weakening ? 'LEGIT' : 'WEAKENING'
  const majorityCount = majority === 'LEGIT' ? legit : weakening
  return {
    name: fixture.name,
    expected: fixture.expected,
    runs,
    unanimous: legit === 0 || weakening === 0,
    majority,
    agreement: runs.length === 0 ? 0 : majorityCount / runs.length,
    matchedExpected: majority === fixture.expected,
  }
}

/**
 * Run each fixture through the judge k times (sequentially, so a real run does
 * not hammer the gateway) and fold the per-fixture and overall agreement.
 */
export async function evaluateJudgeConsistency(
  fixtures: ConsistencyFixture[],
  k: number,
  judge: TamperingJudge
): Promise<ConsistencyReport> {
  const perFixture: FixtureConsistency[] = []
  for (const fixture of fixtures) {
    const runs: JudgeVerdict[] = []
    for (let i = 0; i < k; i++) {
      runs.push(await judge(fixture.input))
    }
    perFixture.push(summarize(fixture, runs))
  }
  const n = perFixture.length
  const unanimousRate =
    n === 0 ? 0 : perFixture.filter(f => f.unanimous).length / n
  const accuracy =
    n === 0 ? 0 : perFixture.filter(f => f.matchedExpected).length / n
  return { k, fixtures: n, perFixture, unanimousRate, accuracy }
}
