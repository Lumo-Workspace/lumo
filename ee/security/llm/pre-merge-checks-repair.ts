/**
 * LUM-1304 — mechanical repair of a pre-merge checks answer whose envelope
 * is wrong but whose judgement is there: a ```json fence around the object,
 * a bare array of results, or the two enum keys swapped (`outcome` on a
 * check, `verdict` on a requirement), and the optional-looking fields left
 * out. Wired into `generateObject` as `experimental_repairText`, so the
 * repaired text is still validated by `PreMergeChecksAnswerSchema`. It never
 * decides a verdict or an outcome: it moves the enum keys the model did
 * write, and fills only empty prose (`explanation`, `resolution`) and an
 * empty `requirements` list — a requirements check left with none is asked
 * again by the service (`unansweredRequirementsByCheck`), not passed.
 *
 * Not repairable (returns null, the call fails as before): no JSON object
 * or array in the text, or JSON without a `results` list. An empty response
 * never reaches here — the SDK throws before asking for a repair.
 *
 * Pure, no runtime dependencies (unit-tested without the SDK).
 */

const CHECK_VERDICTS = new Set(['passed', 'failed', 'inconclusive'])
const REQUIREMENT_OUTCOMES = new Set(['addressed', 'not_addressed', 'unclear'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function parseSpan(inner: string, open: string, close: string): unknown {
  const start = inner.indexOf(open)
  const end = inner.lastIndexOf(close)
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(inner.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * The JSON value in `text` (inside a fence when there is one): the span that
 * opens first, and when that does not parse, the other one — so a bare array
 * stays an array, and a `[` in prose before the object
 * (`[note] {"results": …}`) does not hide it.
 */
function parseJsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const inner = (fenced ? fenced[1] : text) ?? ''
  const objectAt = inner.indexOf('{')
  const arrayAt = inner.indexOf('[')
  const spans: Array<[string, string]> =
    arrayAt !== -1 && (objectAt === -1 || arrayAt < objectAt)
      ? [
          ['[', ']'],
          ['{', '}'],
        ]
      : [
          ['{', '}'],
          ['[', ']'],
        ]
  for (const [open, close] of spans) {
    const value = parseSpan(inner, open, close)
    if (value !== undefined) return value
  }
  return undefined
}

function repairRequirement(r: unknown): unknown {
  if (!isRecord(r)) return r
  const out: Record<string, unknown> = { ...r }
  if (
    out.outcome === undefined &&
    typeof out.verdict === 'string' &&
    REQUIREMENT_OUTCOMES.has(out.verdict)
  ) {
    out.outcome = out.verdict
    delete out.verdict
  }
  if (out.explanation === undefined) out.explanation = ''
  return out
}

function repairResult(r: unknown): unknown {
  if (!isRecord(r)) return r
  const out: Record<string, unknown> = { ...r }
  if (
    out.verdict === undefined &&
    typeof out.outcome === 'string' &&
    CHECK_VERDICTS.has(out.outcome)
  ) {
    out.verdict = out.outcome
    delete out.outcome
  }
  if (out.explanation === undefined) out.explanation = ''
  if (out.resolution === undefined) out.resolution = ''
  out.requirements = Array.isArray(out.requirements)
    ? out.requirements.map(repairRequirement)
    : []
  return out
}

/** The repaired answer as JSON text, or null when there is nothing to fix. */
export function repairPreMergeChecksText(text: string): string | null {
  const parsed = parseJsonIn(text)
  const results = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.results)
      ? parsed.results
      : null
  if (!results) return null
  return JSON.stringify({ results: results.map(repairResult) })
}
