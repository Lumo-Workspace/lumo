/**
 * LUM-1063 — the hook detector's input and output shapes, shared by the core
 * pipeline (`lib/services/boundary-detector.service.ts`) and the detectors a
 * plugin registers (`lib/plugins/crossing-types.ts`). Pure types.
 */
import type {
  BoundaryCrossingCategory,
  BoundaryCrossingSeverity,
} from '@prisma/client'

export interface BoundaryDetectionInput {
  taskId: string
  hookEventId?: string | null
  toolName: string | null
  filePath: string | null
  payload: unknown
}

export interface DetectedCrossing {
  category: BoundaryCrossingCategory
  /** Short, human-readable reason — the matched command, or a redacted label
   *  for a secret (the secret value itself is never stored on the marker). */
  detail: string
  /** Severity tier (LUM-442). HIGH crossings are surfaced most prominently and
   *  force the DONE gate even where the workspace opted out. */
  severity: BoundaryCrossingSeverity
  /** Coalescing target (LUM-477): the specific thing this crossing is about — the
   *  written file for a secret, the normalized command for action
   *  classes. Repeated detections with the same (taskId, category, target) merge
   *  into one OPEN crossing instead of recording a duplicate per event. Never the
   *  secret VALUE — a secret's target is its file, so it stays redacted. */
  target: string
  /** LUM-590: advisory crossings come from project-specific predicates — surfaced
   *  in the panel but never block the DONE gate. A mapped built-in produces a
   *  blocking crossing; a project-specific predicate produces advisory in v1. */
  advisory?: boolean
  /** LUM-590: stable id of the compiled PolicyRule that fired this crossing. */
  policyRuleRef?: string
  /** LUM-590: frozen verbatim text of the policy rule at detection time. */
  policyRuleText?: string
}
