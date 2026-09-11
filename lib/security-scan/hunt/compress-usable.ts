/**
 * LUM-758 follow-up — did a compression actually leave the hunt model
 * something to work with?
 *
 * The first prod read-out of the task graph found the answer had been "no",
 * seven times out of seven, without anyone being able to see it: one task fed
 * 38,585 characters of real repository content through the compressor and got
 * 133 characters back — exactly 7 × `(no relevant lines)`. The agent then
 * burned 38k tokens searching a repository it could not see, and submitted
 * nothing.
 *
 * The guard in place at the time only rejected a completely EMPTY body, and
 * the sentinel is not empty. So this module answers the question the empty
 * check was trying to ask, and answers it as data rather than as a string
 * comparison buried in a service.
 *
 * A compression judged unusable is NOT an error: the compressor is allowed to
 * conclude there is nothing relevant. It just means we must not act on that
 * conclusion — we hand the model the real (truncated) output and let it judge,
 * because a cheap model's omission is not evidence of absence.
 */

/**
 * The exact sentence `security-hunt-compress-client.ts` instructs the
 * compressor to return when it finds nothing. Kept here, next to the code that
 * interprets it, and asserted against the prompt by a test so the two cannot
 * drift into a silent disagreement.
 */
export const NO_RELEVANT_LINES = '(no relevant lines)'

/**
 * Deliberately NOT size-based. A tiny body is as likely to be the BEST possible
 * compression — 8,000 characters of `rg` output in which exactly one line
 * matters — as it is to be a refusal, and nothing about the length tells the
 * two apart. An earlier draft rejected anything under 1% of its input and would
 * have thrown away precisely the compressions worth having.
 *
 * So this judges only what is unambiguous: a blank answer, and the sentence the
 * compressor is explicitly told to return when it finds nothing. Whether a
 * size rule is ever warranted is a question for `HuntAudit.compress`, which now
 * records the input/output characters and the no-op count to answer it with
 * data rather than with a guess.
 */
export interface CompressionUsability {
  usable: boolean
  /** Why it was rejected — recorded in the audit so the next read is a read. */
  reason?: 'empty' | 'sentinel'
}

export function judgeCompression(body: string): CompressionUsability {
  const trimmed = body.trim()
  if (trimmed === '') return { usable: false, reason: 'empty' }
  // Case- and punctuation-tolerant: the model paraphrases its own sentinel
  // often enough that an exact match would miss most of them.
  const normalised = trimmed.toLowerCase().replace(/[.\s]+$/, '')
  if (
    normalised === NO_RELEVANT_LINES.toLowerCase() ||
    normalised === 'no relevant lines'
  ) {
    return { usable: false, reason: 'sentinel' }
  }
  return { usable: true }
}
