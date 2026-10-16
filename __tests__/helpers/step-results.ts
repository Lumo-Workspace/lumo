import type { RecordRunBody } from '@/lib/validation/test-case'

type Tc = { steps: string[]; verification: string[] }
type Entry = NonNullable<RecordRunBody['stepResults']>[number]

/** LUM-1211: 一条完整上报的 PASS——每个步骤与复验都 PASS。 */
export function allPass(tc: Tc): Entry[] {
  return [
    ...tc.steps.map((_, index) => ({
      phase: 'STEPS' as const,
      index,
      status: 'PASS' as const,
    })),
    ...tc.verification.map((_, index) => ({
      phase: 'VERIFICATION' as const,
      index,
      status: 'PASS' as const,
    })),
  ]
}

/** LUM-1211: 断点之前全部 PASS，断点本身 FAIL。 */
export function passUntilFail(
  tc: Tc,
  failing: { phase: 'STEPS' | 'VERIFICATION'; index: number }
): Entry[] {
  const before =
    failing.phase === 'STEPS'
      ? allPass({ steps: tc.steps.slice(0, failing.index), verification: [] })
      : allPass({
          steps: tc.steps,
          verification: tc.verification.slice(0, failing.index),
        })
  return [...before, { ...failing, status: 'FAIL' as const }]
}
