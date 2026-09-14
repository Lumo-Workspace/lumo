/**
 * LUM-739 — should stage A start the L3 hunt for this scan? (spec §6 L3
 * "Hunt" trigger conditions, any one suffices). Pure and cheap: the diff
 * test is a text-level scan of ADDED lines in TS/TSX files against the same
 * callee tables the subgraph builder uses — the full AST subgraph is built
 * later, inside the workflow, only when this says yes.
 */
import type { AddedFile } from '../types'
import { SINK_RULES, CONTROL_RULES, matchCallRule } from '../graph/patterns'
import { isGraphSourcePath } from '../graph/imports'

/** The LUM-736 session-guard categories — an OPEN one is intent evidence. */
export const L4_CROSSING_CATEGORIES = [
  'SENSITIVE_PATH_EDIT',
  'HOOK_BYPASS',
  'TEST_FILE_DELETED',
] as const

export interface HuntTriggerInput {
  files: AddedFile[]
  /** Stage A produced a HIGH finding (secrets or judge). */
  hasHighFinding: boolean
  /** The task has an undispositioned L4 crossing. */
  hasOpenL4Crossing: boolean
}

/**
 * One located rule hit: the rule that fired and the added line it fired on.
 *
 * LUM-758 follow-up. `reasons` is a deduplicated set of rule ids, so it says a
 * sink fired and never where — and the hunt agent was told, in so many words,
 * to "find the call sites yourself". It then spent its budget re-deriving with
 * `rg` what this pass already knew and discarded: across 31 production tasks it
 * never once reached its own `submit_candidates`, because mapping consumed the
 * allowance that was meant for reasoning.
 *
 * `line` is the added line's number in the file at the head sha, which is what
 * the agent's checkout has. It is a STARTING POINT, not a citable fact: the
 * prompt says so, because the system prompt's rule 4 requires every line number
 * in a finding to come from the agent's own `rg -n` / `sed -n` output.
 */
export interface HuntSignalSite {
  /** `entry:next-route-handler`, `sink:fetch`, `control:zod-parse`. */
  rule: string
  path: string
  line: number
}

export interface HuntTriggerResult {
  hunt: boolean
  reasons: string[]
  /**
   * The located hits behind `reasons`, capped. Empty when the only reasons are
   * `stage-a:high` / `l4:open-crossing`, which have no site.
   */
  sites: HuntSignalSite[]
}

/**
 * Caps on the located hits. The total bounds the workflow step input this rides
 * in; the per-rule cap stops one noisy rule (a `zod-parse` on every handler)
 * from crowding out the single `sink` that is the reason to hunt at all.
 */
export const HUNT_SITES_MAX = 40
export const HUNT_SITES_PER_RULE_MAX = 6

const ENTRY_TEXT_RULES: ReadonlyArray<{ id: string; re: RegExp }> = [
  {
    id: 'next-route-handler',
    re: /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/,
  },
  { id: 'next-server-action', re: /^\s*['"]use server['"]/ },
]

const CALLEE_RE = /([A-Za-z_$][\w$]*(?:\.\$?[A-Za-z_$][\w$]*)*)\s*\(/g

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
      for (const m of text.matchAll(CALLEE_RE)) {
        const control = matchCallRule(CONTROL_RULES, m[1] ?? '')
        if (control) ids.add(control.id)
      }
    }
  }
  return [...ids]
}

export function evaluateHuntTrigger(
  input: HuntTriggerInput
): HuntTriggerResult {
  const reasons = new Set<string>()
  const sites: HuntSignalSite[] = []
  const perRule = new Map<string, number>()
  // Same walk, same matches — the location was always here and was thrown away.
  const record = (rule: string, path: string, line: number) => {
    if (sites.length >= HUNT_SITES_MAX) return
    const n = perRule.get(rule) ?? 0
    if (n >= HUNT_SITES_PER_RULE_MAX) return
    perRule.set(rule, n + 1)
    sites.push({ rule, path, line })
  }
  for (const file of input.files) {
    if (!isGraphSourcePath(file.path)) continue
    for (const { text, lineNo } of file.lines) {
      for (const rule of ENTRY_TEXT_RULES) {
        if (rule.re.test(text)) {
          reasons.add(`diff:entry:${rule.id}`)
          record(`entry:${rule.id}`, file.path, lineNo)
        }
      }
      for (const m of text.matchAll(CALLEE_RE)) {
        const callee = m[1] ?? ''
        const sink = matchCallRule(SINK_RULES, callee)
        if (sink) {
          reasons.add(`diff:sink:${sink.id}`)
          record(`sink:${sink.id}`, file.path, lineNo)
        }
        const control = matchCallRule(CONTROL_RULES, callee)
        if (control) {
          reasons.add(`diff:control:${control.id}`)
          record(`control:${control.id}`, file.path, lineNo)
        }
      }
    }
  }
  if (input.hasHighFinding) reasons.add('stage-a:high')
  if (input.hasOpenL4Crossing) reasons.add('l4:open-crossing')
  return { hunt: reasons.size > 0, reasons: [...reasons], sites }
}
