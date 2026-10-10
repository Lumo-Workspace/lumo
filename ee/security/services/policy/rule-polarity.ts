/**
 * LUM-770 — text guard for the policy compiler: does a rule's wording read as
 * an OBLIGATION ("must run X", "X must pass", a PR-checklist item) rather than
 * a PROHIBITION ("never run X", "do not X", "only CI may X")?
 *
 * Why it exists: a deterministic `cmd-substr` action rule means "any executed
 * command containing this substring is a violation". That encoding only makes
 * sense for prohibitions. The LLM compiler turned the CLAUDE.md PR Checklist
 * line ("tests + `npx tsc --noEmit` pass") into exactly such a rule, so every
 * real `npx tsc --noEmit` was recorded as a PROJECT_RULE_VIOLATION (LUM-766).
 * The compiler asks the model for the polarity explicitly AND runs this guard
 * on the rule text, because the observed failure IS the model misreading the
 * sentence — a second, deterministic opinion is the point.
 *
 * Direction of error: a prohibition marker anywhere in the text wins (the rule
 * stays a prohibition), so "must never", "must not", "must only" and "禁止 …
 * 必须" are never downgraded. Only wording with an obligation marker and no
 * prohibition marker at all counts as an obligation. Pure, no I/O.
 */

/** Wording that forbids — any hit keeps the rule a prohibition. */
const PROHIBITION_MARKER =
  /\b(?:never|not|don'?t|forbidden|forbid|prohibited|banned|disallowed|avoid|only)\b|禁止|严禁|不要|不得|不能|不可|不准|勿|别|仅|只|避免/i

/** Wording that obliges — a checklist item, a must-do, a "before a PR" step. */
const OBLIGATION_MARKER =
  /\b(?:must|should|always|required?|ensure|make sure|before|prior to|checklist|pass(?:es|ing)?)\b|必须|务必|需要|应当|应该|总是|一定|之前|前|要|通过|检查清单/i

export function isObligationText(text: string): boolean {
  if (PROHIBITION_MARKER.test(text)) return false
  return OBLIGATION_MARKER.test(text)
}
