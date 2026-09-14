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

export interface HuntTriggerResult {
  hunt: boolean
  reasons: string[]
}

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
  for (const file of input.files) {
    if (!isGraphSourcePath(file.path)) continue
    for (const { text } of file.lines) {
      for (const rule of ENTRY_TEXT_RULES) {
        if (rule.re.test(text)) reasons.add(`diff:entry:${rule.id}`)
      }
      for (const m of text.matchAll(CALLEE_RE)) {
        const callee = m[1] ?? ''
        const sink = matchCallRule(SINK_RULES, callee)
        if (sink) reasons.add(`diff:sink:${sink.id}`)
        const control = matchCallRule(CONTROL_RULES, callee)
        if (control) reasons.add(`diff:control:${control.id}`)
      }
    }
  }
  if (input.hasHighFinding) reasons.add('stage-a:high')
  if (input.hasOpenL4Crossing) reasons.add('l4:open-crossing')
  return { hunt: reasons.size > 0, reasons: [...reasons] }
}
