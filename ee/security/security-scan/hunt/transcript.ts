/**
 * LUM-787 — transcript elision for the hunt's tool loop.
 *
 * A tool-calling loop re-sends its whole transcript on every step, so a tool
 * result is paid for once when it arrives and again on every step after. At
 * HUNT_TASK_TOKEN_MAX that is what decides how many steps a task gets: with
 * results kept whole the transcript grows by the whole step's output each
 * step, and four steps do not fit (`budget-arithmetic.test.ts` walks it).
 *
 * So the model is sent a transcript in which tool results older than the
 * last HUNT_ELIDE_KEEP_STEPS steps are replaced by a short stub. Its own
 * text between steps — what it concluded from those results — stays; the
 * raw output it already read does not. This is what the model is SENT, not
 * what happened: `result.response.messages` and the audit keep every byte.
 *
 * Pure. Handles only the shapes this loop produces (`{ output, error? }` as
 * a JSON tool output, or a text output) and leaves anything else untouched
 * — an unknown part is never a reason to drop content.
 */
import type { ModelMessage } from 'ai'
import {
  HUNT_ELIDE_KEEP_STEPS,
  HUNT_ELIDE_MIN_CHARS,
} from '@/ee/security/services/security-hunt.config'

export interface ElidedTranscript {
  messages: ModelMessage[]
  /** Tool results replaced by a stub. */
  elided: number
  /** Characters those results had; the stubs are not subtracted. */
  elidedChars: number
}

/** The stub keeps no head of the output on purpose — see HUNT_ELIDE_MIN_CHARS. */
export function elisionStub(chars: number): string {
  return `[${chars} characters of output from an earlier step were elided to save budget; re-run the command if you need them]`
}

type ToolOutput = { type: string; value?: unknown }

/**
 * Elide one tool output when it is a shape this loop produces and it is
 * longer than HUNT_ELIDE_MIN_CHARS. Returns null when nothing changes.
 */
function elideOutput(
  output: ToolOutput
): { output: ToolOutput; chars: number } | null {
  if (output.type === 'text' && typeof output.value === 'string') {
    if (output.value.length <= HUNT_ELIDE_MIN_CHARS) return null
    return {
      output: { ...output, value: elisionStub(output.value.length) },
      chars: output.value.length,
    }
  }
  if (
    output.type === 'json' &&
    output.value !== null &&
    typeof output.value === 'object' &&
    typeof (output.value as { output?: unknown }).output === 'string'
  ) {
    const value = output.value as { output: string }
    if (value.output.length <= HUNT_ELIDE_MIN_CHARS) return null
    return {
      output: {
        ...output,
        value: { ...value, output: elisionStub(value.output.length) },
      },
      chars: value.output.length,
    }
  }
  return null
}

/**
 * `messages` is the transcript as the SDK is about to send it: the opening
 * prompt, then assistant / tool message pairs, one pair per completed step.
 * The last `keepSteps` tool messages are the latest steps' results and stay
 * whole; every earlier tool message has its long results stubbed.
 */
export function elideOlderToolResults(
  messages: ReadonlyArray<ModelMessage>,
  keepSteps: number = HUNT_ELIDE_KEEP_STEPS
): ElidedTranscript {
  const toolIndexes: number[] = []
  messages.forEach((m, i) => {
    if (m.role === 'tool') toolIndexes.push(i)
  })
  const cut = Math.max(0, toolIndexes.length - Math.max(0, keepSteps))
  const older = new Set(toolIndexes.slice(0, cut))
  if (older.size === 0) {
    return { messages: [...messages], elided: 0, elidedChars: 0 }
  }

  let elided = 0
  let elidedChars = 0
  const out = messages.map((m, i) => {
    if (!older.has(i) || m.role !== 'tool' || !Array.isArray(m.content)) {
      return m
    }
    let changed = false
    const content = m.content.map(part => {
      if (part.type !== 'tool-result') return part
      const next = elideOutput(part.output as ToolOutput)
      if (next === null) return part
      changed = true
      elided += 1
      elidedChars += next.chars
      return { ...part, output: next.output }
    })
    return changed ? ({ ...m, content } as ModelMessage) : m
  })
  return { messages: out, elided, elidedChars }
}
