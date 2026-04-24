/**
 * Session-summary domain types + tool schemas.
 *
 * The generation pipeline is two calls:
 *   1. Classifier (Haiku) — picks a {@link SessionType} with a confidence.
 *   2. Content generator (Opus) — forced tool_use emits a type-specific
 *      {@link SessionSummaryPayload}.
 *
 * Every {@link SessionType} has a dedicated template + renderer. Low-confidence
 * classifier outputs (< threshold in the service) still fall back to `mixed`
 * rather than a specific template.
 */

export const SESSION_TYPES = [
  'exploration',
  'implementation',
  'debug',
  'refactor',
  'review',
  'mixed',
] as const

export type SessionType = (typeof SESSION_TYPES)[number]

// ─── Content payloads (discriminated by `type`) ─────────────────────────────

export interface ExplorationPayload {
  type: 'exploration'
  whatExplored: string
  keyFindings: string[]
  filesExamined: Array<{ file: string; reason: string }>
  nextSteps: string[]
}

export interface ImplementationPayload {
  type: 'implementation'
  goal: string
  accomplished: string[]
  keyChanges: Array<{ file: string; delta?: string; description: string }>
  unresolved: string[]
}

export type DebugStatus = 'fixed' | 'partial' | 'unresolved'

export interface DebugPayload {
  type: 'debug'
  problem: string
  rootCause: string | null
  fixApplied: Array<{ file: string; delta?: string; description: string }>
  verification: string[]
  status: DebugStatus
}

export interface RefactorPayload {
  type: 'refactor'
  refactorGoal: string
  changes: Array<{ file: string; description: string }>
  scope: { filesCount: number; linesAdded: number; linesRemoved: number }
  behaviorPreservation: string | null
  followUps: string[]
}

export interface ReviewPayload {
  type: 'review'
  reviewScope: string
  findings: string[]
  severity: {
    critical: string[]
    improvements: string[]
    notes: string[]
  }
  recommendations: string[]
}

export interface MixedPayload {
  type: 'mixed'
  overview: string
  mainActivities: string[]
  unresolved: string[]
}

export type SessionSummaryPayload =
  | ExplorationPayload
  | ImplementationPayload
  | DebugPayload
  | RefactorPayload
  | ReviewPayload
  | MixedPayload

// Classifier output (forced tool_use return shape).
export interface ClassifierOutput {
  type: SessionType
  confidence: number
}

// ─── Tool schemas (Anthropic forced tool_use) ───────────────────────────────

export const CLASSIFIER_TOOL = {
  name: 'classify_session',
  description:
    'Classify the overall nature of a Claude Code development session based on the supplied metadata (tool distribution + key assistant messages).',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string' as const,
        enum: [...SESSION_TYPES],
        description:
          'exploration = purely reading/understanding code; implementation = building new features; debug = finding/fixing bugs; refactor = restructuring without behavior change; review = diagnostic code review; mixed = spans multiple types or unclear.',
      },
      confidence: {
        type: 'number' as const,
        minimum: 0,
        maximum: 1,
        description:
          'Your confidence that this single type describes the session. Use < 0.6 when the session genuinely spans multiple activities — the orchestrator will fall back to `mixed` below that threshold.',
      },
    },
    required: ['type', 'confidence'],
  },
}

export const EXPLORATION_TOOL = {
  name: 'emit_exploration_summary',
  description:
    'Emit a structured summary of an exploration session — the developer was reading code and forming a mental model, not changing behavior.',
  input_schema: {
    type: 'object' as const,
    properties: {
      whatExplored: {
        type: 'string' as const,
        description:
          '1-2 sentence scope of the investigation (what system/module/question).',
      },
      keyFindings: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Concrete insights learned — things the developer now knows that they did not before. Empty if the session was inconclusive.',
      },
      filesExamined: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            file: { type: 'string' as const },
            reason: {
              type: 'string' as const,
              description:
                'Why this file mattered — the role it played in the investigation.',
            },
          },
          required: ['file', 'reason'],
        },
        description: 'Up to ~6 of the most relevant files.',
      },
      nextSteps: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Follow-ups the investigation makes concrete — what to do, build, or fix next. Empty if none are obvious.',
      },
    },
    required: ['whatExplored', 'keyFindings', 'filesExamined', 'nextSteps'],
  },
}

export const IMPLEMENTATION_TOOL = {
  name: 'emit_implementation_summary',
  description:
    'Emit a structured summary of an implementation session (building new features or modules).',
  input_schema: {
    type: 'object' as const,
    properties: {
      goal: {
        type: 'string' as const,
        description:
          'One-sentence statement of what the developer set out to build. Infer from first assistant messages + tool pattern.',
      },
      accomplished: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Concrete items delivered — user-visible outcomes, not file-level noise. Empty array if nothing shipped cleanly.',
      },
      keyChanges: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            file: { type: 'string' as const },
            delta: {
              type: 'string' as const,
              description: 'Like "+12 -4" when known from Edit events.',
            },
            description: {
              type: 'string' as const,
              description: 'One short phrase on what changed in this file.',
            },
          },
          required: ['file', 'description'],
        },
        description:
          'The handful of files that carry the real change. Not an exhaustive list — pick up to ~6.',
      },
      unresolved: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Things the session ended on without finishing: failing tests, TODO notes, explicit "next up" statements. Empty array if everything wrapped cleanly.',
      },
    },
    required: ['goal', 'accomplished', 'keyChanges', 'unresolved'],
  },
}

export const DEBUG_TOOL = {
  name: 'emit_debug_summary',
  description:
    'Emit a structured summary of a debug session — the developer was tracking down and fixing a bug.',
  input_schema: {
    type: 'object' as const,
    properties: {
      problem: {
        type: 'string' as const,
        description: '1-2 sentence statement of the bug being investigated.',
      },
      rootCause: {
        type: ['string', 'null'] as unknown as 'string',
        description:
          'The actual underlying cause once identified. Null if the session ended before the root cause was understood.',
      },
      fixApplied: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            file: { type: 'string' as const },
            delta: { type: 'string' as const },
            description: { type: 'string' as const },
          },
          required: ['file', 'description'],
        },
        description:
          'Files touched as part of the fix. Empty if nothing was changed yet.',
      },
      verification: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'How the fix was verified: tests that passed, manual checks, reproductions that no longer reproduce. Empty if no verification yet.',
      },
      status: {
        type: 'string' as const,
        enum: ['fixed', 'partial', 'unresolved'],
        description:
          'fixed = bug is confirmed gone; partial = one symptom fixed but concerns remain; unresolved = session ended without a working fix.',
      },
    },
    required: ['problem', 'rootCause', 'fixApplied', 'verification', 'status'],
  },
}

export const REFACTOR_TOOL = {
  name: 'emit_refactor_summary',
  description:
    'Emit a structured summary of a refactor session — restructuring existing code without changing its observable behavior.',
  input_schema: {
    type: 'object' as const,
    properties: {
      refactorGoal: {
        type: 'string' as const,
        description:
          'The shape improvement being targeted (e.g. "extract repository layer out of service", "split fat component into per-section files").',
      },
      changes: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            file: { type: 'string' as const },
            description: {
              type: 'string' as const,
              description:
                'Nature of the change in this file (e.g. "extracted X into Y", "renamed Foo to Bar").',
            },
          },
          required: ['file', 'description'],
        },
        description: 'Up to ~8 of the most structurally meaningful changes.',
      },
      scope: {
        type: 'object' as const,
        properties: {
          filesCount: { type: 'integer' as const, minimum: 0 },
          linesAdded: { type: 'integer' as const, minimum: 0 },
          linesRemoved: { type: 'integer' as const, minimum: 0 },
        },
        required: ['filesCount', 'linesAdded', 'linesRemoved'],
      },
      behaviorPreservation: {
        type: ['string', 'null'] as unknown as 'string',
        description:
          'Evidence the refactor preserved behavior: tests rerun, type-check passed, manual spot-check. Null if no preservation signal was observed.',
      },
      followUps: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Further structural work this refactor makes possible or still requires.',
      },
    },
    required: [
      'refactorGoal',
      'changes',
      'scope',
      'behaviorPreservation',
      'followUps',
    ],
  },
}

export const REVIEW_TOOL = {
  name: 'emit_review_summary',
  description:
    'Emit a structured summary of a review/diagnostic session — the developer was inspecting existing code to understand its quality, risks, or readiness.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reviewScope: {
        type: 'string' as const,
        description: 'What was reviewed (module, PR, subsystem, invariant).',
      },
      findings: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Concrete observations surfaced during the review — one line each.',
      },
      severity: {
        type: 'object' as const,
        properties: {
          critical: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
              'Blocking issues: bugs, security holes, correctness problems.',
          },
          improvements: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
              'Non-blocking but worth addressing: clarity, naming, small smells.',
          },
          notes: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
              'Neutral observations or questions for the author — no action required.',
          },
        },
        required: ['critical', 'improvements', 'notes'],
      },
      recommendations: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Actionable next steps, ordered by priority when obvious.',
      },
    },
    required: ['reviewScope', 'findings', 'severity', 'recommendations'],
  },
}

export const MIXED_TOOL = {
  name: 'emit_mixed_summary',
  description:
    'Fallback template for sessions that span multiple activities or that the classifier wasn\u2019t confident about.',
  input_schema: {
    type: 'object' as const,
    properties: {
      overview: {
        type: 'string' as const,
        description:
          '1-2 sentence narrative of what happened across the session.',
      },
      mainActivities: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Rough chronological list of distinct activities — one line each.',
      },
      unresolved: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Anything left pending at session end.',
      },
    },
    required: ['overview', 'mainActivities', 'unresolved'],
  },
}
