/** @jest-environment node */
import {
  admitStepOutput,
  newStepLedger,
  stepClipNote,
  STEP_CLIP_MIN_CHARS,
} from '@/lib/security-scan/hunt/step-output'
import { HUNT_STEP_OUTPUT_MAX } from '@/lib/services/security-hunt.config'

// LUM-787 — the per-step ledger. `runHuntShell` caps one command; nothing
// capped what a step's parallel commands returned together, and in prod one
// step added 25–36k characters to a transcript every later step re-sent.
describe('LUM-787 step output ledger', () => {
  it('admits outputs byte-identical while the step is under the ceiling', () => {
    const ledger = newStepLedger()
    const a = 'a'.repeat(1_000)
    const b = 'b\n'.repeat(500)
    expect(admitStepOutput(ledger, a)).toEqual({
      output: a,
      clipped: false,
      dropped: 0,
    })
    expect(admitStepOutput(ledger, b)).toEqual({
      output: b,
      clipped: false,
      dropped: 0,
    })
    expect(ledger.used).toBe(2_000)
  })

  it('cuts the output that crosses the ceiling to the room left and says why', () => {
    const ledger = newStepLedger()
    admitStepOutput(ledger, 'x'.repeat(HUNT_STEP_OUTPUT_MAX - 500))
    const out = admitStepOutput(ledger, 'y'.repeat(1_200))
    expect(out.clipped).toBe(true)
    expect(out.dropped).toBe(700)
    // The kept fragment is exactly the room, then the note — which names the
    // ceiling and how many characters went, so the model can size its next
    // step and knows the cut was about the STEP, not this command.
    expect(out.output.startsWith('y'.repeat(500))).toBe(true)
    expect(out.output).toBe(
      `${'y'.repeat(500)}${stepClipNote(700, HUNT_STEP_OUTPUT_MAX)}`
    )
    expect(out.output).toContain(`exceeded ${HUNT_STEP_OUTPUT_MAX} characters`)
    expect(out.output).toContain('700 characters of this output were cut')
    expect(out.output).toContain('re-run this one alone')
    expect(ledger.used).toBe(HUNT_STEP_OUTPUT_MAX)
  })

  it('returns the note alone when the room left is too small to read', () => {
    const ledger = newStepLedger()
    admitStepOutput(ledger, 'x'.repeat(HUNT_STEP_OUTPUT_MAX - 50))
    const big = 'z'.repeat(3_000)
    const out = admitStepOutput(ledger, big)
    expect(out).toEqual({
      output: stepClipNote(3_000, HUNT_STEP_OUTPUT_MAX).trimStart(),
      clipped: true,
      dropped: 3_000,
    })
    expect(out.output.startsWith('[step output ceiling')).toBe(true)
  })

  it('lets a small output through even once the step is full — the hit is worth more than the note', () => {
    const ledger = newStepLedger()
    admitStepOutput(ledger, 'x'.repeat(HUNT_STEP_OUTPUT_MAX))
    const hit = 'lib/a.ts:12: prisma.$queryRawUnsafe(sql)'
    expect(hit.length).toBeLessThanOrEqual(STEP_CLIP_MIN_CHARS)
    expect(admitStepOutput(ledger, hit)).toEqual({
      output: hit,
      clipped: false,
      dropped: 0,
    })
    // …and it is still counted, so the overshoot is bounded by the number of
    // small commands, not open-ended.
    expect(ledger.used).toBe(HUNT_STEP_OUTPUT_MAX + hit.length)
    // An empty answer (a refusal, a failure, a search that matched nothing)
    // costs nothing.
    expect(admitStepOutput(ledger, '')).toEqual({
      output: '',
      clipped: false,
      dropped: 0,
    })
  })

  it('an output that exactly fills the room is admitted whole', () => {
    const ledger = newStepLedger()
    const exact = 'e'.repeat(HUNT_STEP_OUTPUT_MAX)
    expect(admitStepOutput(ledger, exact).clipped).toBe(false)
    expect(ledger.used).toBe(HUNT_STEP_OUTPUT_MAX)
  })

  it('a fresh ledger forgets the previous step', () => {
    let ledger = newStepLedger()
    admitStepOutput(ledger, 'x'.repeat(HUNT_STEP_OUTPUT_MAX))
    ledger = newStepLedger()
    const out = admitStepOutput(ledger, 'y'.repeat(1_000))
    expect(out.clipped).toBe(false)
    expect(ledger.used).toBe(1_000)
  })

  it('honours a caller-supplied ceiling', () => {
    const ledger = newStepLedger()
    const out = admitStepOutput(ledger, 'q'.repeat(1_000), 500)
    expect(out.clipped).toBe(true)
    expect(out.dropped).toBe(500)
    expect(out.output).toContain('exceeded 500 characters')
  })
})
