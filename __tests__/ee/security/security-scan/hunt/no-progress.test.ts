/** @jest-environment node */
/**
 * LUM-799 — the no-progress stop, judged against the scan that opened the
 * task: PR 1032, scan 58adbdb (2026-09-16), read with
 * `lumo pr scan 1032 --all --full`.
 *
 * The three searches in that scan are the whole calibration set, and they
 * pull in opposite directions:
 *
 *   - t2 alternated two `sed` slices it had already read for 46 of its 74
 *     steps and spent 477,248 of the scan's 735,528 tokens. It must stop.
 *   - t1 (39 commands, 40 steps) and t3 (16 commands, 17 steps) both called
 *     `submit_candidates` themselves. Neither may be touched — a search
 *     stopped early answers from less than it read, which is a worse failure
 *     than the loop.
 *
 * The fixtures are the recorded command lists, in order. The read-out
 * redacts long literals (`rg -n "mech…(len 28)"`), so each redacted literal
 * is replaced by a filler of exactly the recorded length: what the detector
 * reads is command IDENTITY, and identity and distinctness are preserved
 * byte for byte — including the quoting difference (`cat "f"` vs `cat 'f'`)
 * that t1 really did produce and that really is two different commands.
 */
import {
  commandsOfStep,
  isNoProgress,
  noProgressStreak,
  normalizeCommand,
} from '@/ee/security/security-scan/hunt/progress'
import { HUNT_NO_PROGRESS_STEPS } from '@/ee/security/services/security-hunt.config'

/** The file all three searches read, at its full 65 characters. */
const F = '__tests__/security-scan/hunt/mechanical-verify-resolution.test.ts'

/** A redacted literal, restored to its recorded length. */
function lit(head: string, len: number): string {
  return head.length >= len ? head.slice(0, len) : head.padEnd(len, 'x')
}

/** One step per command — which is what all three searches did. */
function stepsOf(commands: readonly string[]) {
  return commands.map(command => ({
    toolCalls: [{ toolName: 'run_shell', input: { command } }],
  }))
}

/**
 * The step the loop would stop on, 1-based, or null when it never does —
 * the prefix walk `stopWhen` performs, run over a recorded search.
 */
function stopStep(
  commands: readonly string[],
  threshold: number
): number | null {
  const steps = stepsOf(commands)
  for (let i = 1; i <= steps.length; i += 1) {
    if (isNoProgress(steps.slice(0, i), threshold)) return i
  }
  return null
}

/** The longest streak the search ever reached — its margin to the threshold. */
function maxStreak(commands: readonly string[]): number {
  const steps = stepsOf(commands)
  let max = 0
  for (let i = 1; i <= steps.length; i += 1) {
    max = Math.max(max, noProgressStreak(steps.slice(0, i)))
  }
  return max
}

/** t2 (idor): 73 commands, the last 50 an alternation of two already-read slices. */
const T2: string[] = [
  `cat "${F}"`,
  `head -n 100 "${F}"`,
  `tail -n +50 "${F}"`,
  `sed -n '1,50p' "${F}"`,
  `sed -n '51,100p' "${F}"`,
  `wc -l "${F}"`,
  `sed -n '25,60p' "${F}"`,
  `sed -n '25,80p' "${F}"`,
  `rg -A 5 -B 5 "${lit('mech', 28)}" "${F}"`,
  `sed -n '29p' "${F}"`,
  `sed -n '27,35p' "${F}"`,
  `sed -n '40,55p' "${F}"`,
  `sed -n '${lit('29p;', 11)}' "${F}"`,
  `sed -n '25,35p' "${F}"`,
  `sed -n '40,50p' "${F}"`,
  `sed -n '50,55p' "${F}"`,
  `sed -n '40,48p' "${F}"`,
  `sed -n '25,40p' "${F}"`,
  `sed -n '40,55p' "${F}"`,
  `sed -n '25,45p' "${F}"`,
  `sed -n '35,55p' "${F}"`,
  `sed -n '25,40p' "${F}"`,
  `sed -n '40,55p' "${F}"`,
  ...Array.from({ length: 50 }, (_, i) =>
    i % 2 === 0 ? `sed -n '25,35p' "${F}"` : `sed -n '35,45p' "${F}"`
  ),
]

/** t1 (injection): 39 commands, 40 steps, submitted on its own. */
const T1: string[] = [
  `cat "${F}"`,
  `sed -n '40,80p' "${F}"`,
  `head -40 "${F}"`,
  `tail -n +40 "${F}"`,
  `sed -n '1,30p' "${F}"`,
  `sed -n '30,60p' "${F}"`,
  `sed -n '60,100p' "${F}"`,
  `rg -n "${lit('mech', 28)}" .`,
  'git diff --name-only HEAD^ HEAD',
  'git ls-files --others --modified --exclude-standard',
  'find . -name "*.ts" -o -name "*.js" | head -20',
  'ls __tests__/security-scan/hunt/',
  `cat '${F}'`,
  `sed -n '40,80p' '${F}'`,
  `sed -n '1,40p' '${F}'`,
  `sed -n '40,80p' '${F}'`,
  `sed -n '80,120p' '${F}'`,
  `wc -l '${F}'`,
  `sed -n '25,55p' '${F}'`,
  `sed -n '1,35p' '${F}'`,
  `sed -n '40,60p' '${F}'`,
  `sed -n '50,70p' '${F}'`,
  `find . -name "*.ts" -o -name "*.js" | xargs grep -l "${lit('POST', 26)}" | grep -E "${lit('(api', 11)}" | head -10`,
  'find . -name "route.ts" -o -name "route.ts"',
  `rg -n "${lit('\\$qu', 60)}" app/api/ | head -10`,
  `rg -F "${lit('\\$qu', 10)}" . --type ts`,
  `find app -name "route.ts" | head -5 | xargs -I {} grep -H -A 10 -B 5 "${lit('para', 29)}" {}`,
  'find app -name "route.ts" -exec basename -a {} \;',
  'find app -name "route.ts"',
  `find app -name "${lit('*mec', 12)}" -o -name "${lit('*ver', 8)}" | grep -i route`,
  `rg -F "${lit('quer', 8)}" . --type ts`,
  `rg -A 5 -B 5 "${lit('quer', 36)}" . --type ts`,
  `rg -F "${lit('$que', 9)}" . --type ts`,
  `rg -F "${lit('quer', 14)}" . --type ts`,
  `sed -n '40,55p' '${F}'`,
  `sed -n '25,35p' '${F}'`,
  `sed -n '28,35p' '${F}'`,
  `sed -n '40,55p' '${F}'`,
  `sed -n '25,35p' '${F}'`,
]

/** t3 (prompt_injection): 16 commands, 17 steps, submitted on its own. */
const T3: string[] = [
  `cat ${F}`,
  `tail -n +20 ${F}`,
  `rg -n "${lit('mech', 28)}" ${F}`,
  `find __tests__ -name "${lit('*mec', 12)}" -type f`,
  `cat ${F}`,
  `sed -n '40,80p' ${F}`,
  `sed -n '1,40p' ${F}`,
  `sed -n '41,80p' ${F}`,
  `sed -n '81,120p' ${F}`,
  `sed -n '${lit('121,', 8)}' ${F}`,
  `wc -l ${F}`,
  `sed -n '25,35p' ${F}`,
  `sed -n '40,60p' ${F}`,
  `sed -n '28,32p' ${F}`,
  `sed -n '42,46p' ${F}`,
  `sed -n '50,55p' ${F}`,
]

describe('LUM-799 hunt no-progress stop', () => {
  it('replays the recorded scan at the recorded lengths', () => {
    // The fixtures are only evidence if they are the searches that ran.
    expect(F).toHaveLength(65)
    expect(T1).toHaveLength(39)
    expect(T2).toHaveLength(73)
    expect(T3).toHaveLength(16)
  })

  it('no-progress stops the PR 1032 t2 alternation before step 30', () => {
    const at = stopStep(T2, HUNT_NO_PROGRESS_STEPS)
    // Steps 22, 23 and 24 are all re-runs of slices read at steps 18, 12 and
    // 14 — the third one in a row is where the search stops asking for
    // anything new, and where it is stopped.
    expect(at).toBe(24)
    expect(at).toBeLessThan(30)
    // The search ran 74 steps in production and submitted at the last one.
    // Everything between is what this buys back.
    expect(74 - (at as number)).toBe(50)
  })

  it('no-progress leaves the converging t1 and t3 searches of the same scan alone', () => {
    expect(stopStep(T1, HUNT_NO_PROGRESS_STEPS)).toBeNull()
    expect(stopStep(T3, HUNT_NO_PROGRESS_STEPS)).toBeNull()
    // And not by a hair: t1's worst moment is two repeats in a row, t3's is
    // one. The threshold has a step of margin over the searches it must not
    // touch, which is the number to re-read if it is ever changed.
    expect(maxStreak(T1)).toBe(2)
    expect(maxStreak(T3)).toBe(1)
    expect(HUNT_NO_PROGRESS_STEPS).toBeGreaterThan(maxStreak(T1))
  })

  it('no-progress counts a streak only from commands an earlier step already ran', () => {
    const a = `sed -n '1,20p' ${F}`
    const b = `sed -n '20,40p' ${F}`
    const c = `rg -n "x" ${F}`
    // Two repeats, then something new: the streak is cleared, not carried.
    expect(noProgressStreak(stepsOf([a, b, a, b, c]))).toBe(0)
    expect(noProgressStreak(stepsOf([a, b, a, b]))).toBe(2)
    // A step that re-reads two known slices AND opens a new file is a search
    // narrowing in — every command must be old for the step to count.
    expect(
      noProgressStreak([
        ...stepsOf([a, b]),
        { toolCalls: [{ toolName: 'run_shell', input: { command: a } }] },
        {
          toolCalls: [
            { toolName: 'run_shell', input: { command: b } },
            { toolName: 'run_shell', input: { command: c } },
          ],
        },
      ])
    ).toBe(0)
    // The same command twice inside one step: new the first time, a repeat
    // the second — the same rule as across steps.
    expect(
      noProgressStreak([
        {
          toolCalls: [
            { toolName: 'run_shell', input: { command: a } },
            { toolName: 'run_shell', input: { command: a } },
          ],
        },
      ])
    ).toBe(0)
  })

  it('no-progress ignores a step that called no shell command', () => {
    const a = `cat ${F}`
    // The submission step, and a step of pure text, are the model deciding —
    // never the failure this reads. Both clear the streak.
    expect(
      noProgressStreak([
        ...stepsOf([a, a, a]),
        { toolCalls: [{ toolName: 'submit_candidates', input: {} }] },
      ])
    ).toBe(0)
    expect(noProgressStreak([...stepsOf([a, a, a]), { toolCalls: [] }])).toBe(0)
    expect(noProgressStreak([...stepsOf([a, a, a]), {}])).toBe(0)
    // A malformed call carries no command and is not a shell read either.
    expect(commandsOfStep({ toolCalls: [{ toolName: 'run_shell' }] })).toEqual(
      []
    )
    expect(
      commandsOfStep({
        toolCalls: [{ toolName: 'run_shell', input: { command: '   ' } }],
      })
    ).toEqual([])
  })

  it('no-progress reads spacing, never quoting or case', () => {
    expect(normalizeCommand("  sed  -n '1,2p'   a.ts ")).toBe(
      "sed -n '1,2p' a.ts"
    )
    // t1 really did run `cat "f"` and then `cat 'f'`; folding the two would
    // have counted a repeat the shell never saw.
    expect(normalizeCommand(`cat "${F}"`)).not.toBe(
      normalizeCommand(`cat '${F}'`)
    )
    expect(normalizeCommand('rg -N x')).not.toBe(normalizeCommand('rg -n x'))
  })

  it('no-progress is off, not instant, at a threshold of zero', () => {
    const a = `cat ${F}`
    expect(isNoProgress(stepsOf([a, a, a, a, a]), 0)).toBe(false)
    expect(isNoProgress([], HUNT_NO_PROGRESS_STEPS)).toBe(false)
  })
})
