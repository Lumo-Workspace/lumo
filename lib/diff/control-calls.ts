/**
 * LUM-1060 — "which control calls (auth / zod parse / rate limit / workspace
 * scope) do the ADDED lines make?", moved into the core from the L3 hunt
 * (`lib/security-scan/hunt/trigger`, `lib/security-scan/graph/patterns`)
 * because the claim-faithfulness prefilter asks the same question. Pure:
 * text-level, no AST, no I/O. The hunt keeps importing these through its old
 * modules, which re-export them.
 *
 * `callee` regexes are tested against the dotted callee text of a call
 * expression (`prisma.$queryRawUnsafe`, `schema.parse`, `fetch`).
 */
import type { AddedFile } from './diff-lines'

export interface CallRule {
  id: string
  callee: RegExp
}

export const CONTROL_RULES: readonly CallRule[] = [
  {
    id: 'auth',
    callee:
      /(^|\.)(auth|currentUser|getAuth|requireAuth|requireMember|requireWorkspaceMember|requireWorkspaceAccess|assertMember|assertWorkspaceAccess|resolveMember|getCurrentMember|requireApiKey|verifyApiKey|verifyOidc\w*|authenticate\w*|authorize\w*)$/,
  },
  { id: 'zod-parse', callee: /\.(parse|safeParse|parseAsync|safeParseAsync)$/ },
  {
    id: 'rate-limit',
    callee:
      /(^|\.)(rateLimit|ratelimit|checkRateLimit|enforceRateLimit|assertRateLimit)$/,
  },
  {
    id: 'workspace-scope',
    callee:
      /(^|\.)(assertWorkspace\w*|requireWorkspace\w*|scopeToWorkspace|withWorkspace\w*)$/,
  },
]

export function matchCallRule(
  rules: readonly CallRule[],
  callee: string
): CallRule | null {
  for (const r of rules) if (r.callee.test(callee)) return r
  return null
}

/**
 * LUM-833 — a callee match may only START at the head of an identifier chain:
 * not right after an identifier character, and not right after
 * `identifier.`. Without that, one long identifier-like run (a minified bundle
 * or generated file committed in a PR — 200,000 characters on one line) was
 * retried at every position inside it, each retry reading to the end of the
 * run and backtracking all the way back: O(n²), ~21 s per pass, and stage A
 * evaluates the trigger twice.
 *
 * The anchor finds exactly the same calls. A start inside an identifier (or
 * right after `identifier.`) has the same end as the start at the head of its
 * chain, so it can only succeed where the head start already matched — and
 * that match consumed it. A receiver the regex has no grammar for keeps its
 * start: in `/re/.exec(`, `f().exec(` or `a[0].exec(` the character before
 * the `.` is not an identifier character (see `calleeAt`). The one input that
 * reads differently is an identifier glued straight onto a digit (`9abc(`,
 * `1.exec(`), which is not a call in valid JS.
 */
const CALLEE_RE =
  /(?<![\w$])(?<![\w$]\.)([A-Za-z_$][\w$]*(?:\.\$?[A-Za-z_$][\w$]*)*)\s*\(/g

/**
 * LUM-809 — the callee as it really was written, not as `CALLEE_RE` could
 * spell it.
 *
 * `CALLEE_RE` can only start at an identifier, so a receiver it has no grammar
 * for — a regex literal, a string, a call result, an index — is dropped and
 * the property read comes back looking bare: `/re/.exec(s)` and an imported
 * `exec(cmd)` both arrive as `exec`. The rule tables are then asked a question
 * about a call shape that never existed, and `(^|\.)` vs `^…$` — the very
 * distinction they use to separate a method from a free function — decides
 * nothing.
 *
 * A match whose preceding character is `.` is exactly the case the regex could
 * not start: the receiver is not an identifier chain. Restoring the leading
 * dot reports that in the vocabulary the tables already speak, and lines a
 * dropped receiver up with a captured one (`x.exec` and `/re/.exec` now answer
 * the same). Only `.` qualifies — `a/exec(x)` is division, not a receiver.
 */
function calleeAt(text: string, index: number, captured: string): string {
  return index > 0 && text[index - 1] === '.' ? `.${captured}` : captured
}

/**
 * Every call on one added line, as `CALLEE_RE` + `calleeAt` read it — the one
 * walk both the trigger and `addedControlCallIds` make. Linear in the line's
 * length (LUM-833).
 */
export function calleesOf(text: string): string[] {
  const callees: string[] = []
  for (const m of text.matchAll(CALLEE_RE)) {
    callees.push(calleeAt(text, m.index, m[1] ?? ''))
  }
  return callees
}

/**
 * LUM-740 — the control rules (auth / zod parse / rate limit / workspace
 * scope) that the ADDED lines call, by rule id, across every file. Shared
 * with the claim-faithfulness prefilter: "the diff adds a control" is the
 * same question the hunt trigger asks, minus the source-path filter.
 */
export function addedControlCallIds(files: AddedFile[]): string[] {
  const ids = new Set<string>()
  for (const file of files) {
    for (const { text } of file.lines) {
      for (const callee of calleesOf(text)) {
        const control = matchCallRule(CONTROL_RULES, callee)
        if (control) ids.add(control.id)
      }
    }
  }
  return [...ids]
}
