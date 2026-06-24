/**
 * LUM-579 — the operational definition of a "negative claim": a frozen
 * task-level claim (Task.claimSnapshot) whose text says the run only
 * explored / made no code changes, on a task that is in fact DONE and verified.
 *
 * Shared by enumerate.ts (recover the set + count beforeNeg), audit.ts (measure
 * the count before/after), and regenerate.ts (label the proposed summaries).
 * Same classifier across all three so the before/after delta is apples-to-apples.
 *
 * Heuristic, intentionally generous on the negative side: it transcribes the
 * phrasings the under-reporting sessions actually produced (see the LUM-579
 * probe output). It is a measurement aid, not a contract — the goal is a
 * consistent yardstick for the delta, not a perfect oracle.
 */

const NEGATIVE_PATTERNS: RegExp[] = [
  // English
  /\bno code chang/i,
  /\bno (actual )?(code )?(modif|change|implement)/i,
  /\bdid not (implement|modify|change|write|make)/i,
  /\bnot (yet )?(been )?(implement|modif|chang)/i,
  /\bremains? (at the )?(exploratory|exploration)/i,
  /\bonly explor/i,
  /\bno changes were (made|implemented)/i,
  // Chinese
  /尚未.{0,8}(改|修改|实施|实现|进行|完成|开始)/,
  /未(改|做|实施|进行|完成|实现|编写).{0,6}代码/,
  /没有.{0,6}(修改|改动|实施|进行).{0,6}代码/,
  /仅.{0,8}(探索|调研|收集|理解|梳理|分析|完成了技术)/,
  /(尚未|还未|未).{0,6}(实施|进行|完成|做出).{0,6}(任何|实际)?.{0,4}(代码)?.{0,4}(修改|改动|变更)/,
  /(代码)?.{0,4}(修改|改动|实现|实施).{0,6}尚未/,
]

/**
 * Strong, concrete delivery evidence in the claim text itself. When the agent's
 * own account already says it implemented/modified files, pushed, or opened a
 * PR, a trailing "leftover X 尚未解决" note does NOT make the run a non-delivery —
 * so such a claim is excluded from the negative set even if a negative pattern
 * also matches. This keeps beforeNeg measuring genuine under-reports (the run
 * claims it changed nothing) rather than honest "delivered, with follow-ups".
 */
const DELIVERY_PATTERNS: RegExp[] = [
  /实现了.{0,12}(功能|逻辑|文件|测试|代码|需求)/,
  /修改了.{0,12}(核心|逻辑|文件|测试|代码|多个)/,
  /(已)?(将代码)?推送到?.{0,6}(远程|分支)|通过\s*git\s*(推送|push)/,
  /创建了?\s*PR|PR\s*#\s*\d+|opened (a )?pull request/i,
  /\bimplemented\b.{0,40}\b(file|test|logic|feature|code|\.tsx?)\b/i,
  /\bmodified\b.{0,30}\b(file|\.tsx?|core)\b/i,
  /\bpushed\b.{0,20}\b(branch|remote|origin)\b/i,
]

export function isNegativeClaim(text: string | null | undefined): boolean {
  if (!text) return false
  if (!NEGATIVE_PATTERNS.some(re => re.test(text))) return false
  // A negative assertion next to concrete delivery evidence = honest
  // "delivered with follow-ups", not an under-report.
  if (DELIVERY_PATTERNS.some(re => re.test(text))) return false
  return true
}
