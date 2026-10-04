/**
 * LUM-984 — the shared shapes of the boundary-crossing monitor evaluation:
 * any dataset × any judge, scored and reported the same way.
 *
 * A dataset adapter turns its source into `EvalSample`s; a judge turns a
 * sample into a `Verdict`; `scoreRun` (score.ts) turns the pairs into one
 * `EvalReport`. Every sample of one run has the same `unit` — a rate over
 * actions and a rate over trajectories are never mixed in one report.
 */
import type { DetectedCrossing } from '@/lib/services/boundary-detector.service'
import type { PolicyRule } from '@/lib/services/policy/types'

/**
 * What one sample is — the denominator every rate in a report is over.
 *   action     one tool call (the gold corpus);
 *   trajectory one agent run, many tool calls (BashArena, ControlArena);
 *   record     one R-Judge record (a multi-turn agent episode);
 *   crossing   one production boundary crossing (LUM-945).
 */
export type EvalUnit = 'action' | 'trajectory' | 'record' | 'crossing'

/** A PostToolUse-shaped event, as the CLI hook posts it. */
export interface EvalEvent {
  toolName: 'Bash' | 'Write' | 'Edit' | 'Read'
  filePath: string | null
  payload: unknown
}

/**
 * Ground truth:
 *   positive  the monitor must flag it (an attack, an unsafe record, a real
 *             forbidden action);
 *   negative  the monitor must not flag it;
 *   advisory  the monitor must RECORD an advisory crossing of `category` and
 *             must not block (LUM-963 advisory-only shapes; gold corpus only).
 */
export type EvalLabel = 'positive' | 'negative' | 'advisory'

export interface EvalSample {
  /** Unique within the dataset; a records file keys its judgements by it. */
  id: string
  label: EvalLabel
  /** Obfuscated positive — reported apart, never part of the detection rate. */
  evasion?: boolean
  /**
   * positive / advisory: the crossing category a category-aware judge (the
   * rule detector) must raise for a hit. Category-blind judges (an LLM
   * suspicion score) hit on any flag.
   */
  category?: string
  /** negative: an advisory crossing of this category also counts as an alarm
   *  (LUM-963 advisory-only categories — a noisy advisory rule must fail). */
  alarmOnAdvisory?: string
  /** Breakdown dimensions, e.g. `{ sideTask: ['sudo_edit'], split: ['tune'] }`.
   *  A sample counts once under each listed value. */
  groups: Record<string, string[]>
  /** The tool calls the rule detector sees, in order. */
  events: EvalEvent[]
  /** Compiled project action rules to run alongside the built-ins (gold). */
  projectRules?: PolicyRule[]
}

export interface Verdict {
  /** 0..1 suspicion; flagged when ≥ the run threshold. null = the judge call
   *  failed — scored as not flagged, never as a detection. */
  score: number | null
  /** Distinct blocking crossing categories (category-aware judges only). */
  blocking: string[]
  /** Distinct advisory (recorded, never blocking) crossing categories. */
  advisory: string[]
  /** Rule judges: every crossing, with the index of the event that raised it. */
  crossings?: { eventIndex: number; crossing: DetectedCrossing }[]
  /** One line on why (an LLM reason); redacted before it is written out. */
  reason?: string
}

export interface Judge {
  id: string
  /** Human-readable configuration, printed in the report header. */
  describe: string
  /** True when `blocking` carries Lumo crossing categories. */
  categoryAware: boolean
  /** True when scores are continuous, so a threshold has to be chosen. */
  scored: boolean
  /** undefined = the judge has no judgement for this sample (not in the
   *  records file) — the sample is excluded and counted as unjudged. */
  judge(sample: EvalSample): Promise<Verdict | undefined>
}

/** One labeled class row of a report. */
export interface ClassStats {
  n: number
  /** positive / evasion: detected · negative: false alarms ·
   *  advisory: recorded as advisory without blocking. */
  hits: number
  rate: number | null
  /** Wilson 95% interval of `rate`. */
  wilson: [number, number] | null
}

export interface GroupRow {
  dimension: string
  value: string
  positive: ClassStats
  negative: ClassStats
}

export interface SampleOutcome {
  id: string
  label: EvalLabel
  evasion: boolean
  score: number | null
  flagged: boolean
  /** positive / evasion / advisory: caught · negative: raised an alarm. */
  hit: boolean
  blocking: string[]
  advisory: string[]
  /** Redacted, truncated evidence for the miss / false-alarm lists. */
  evidence: string
}

export interface EvalReport {
  dataset: string
  datasetOptions: string
  judge: string
  unit: EvalUnit
  threshold: number
  thresholdSource: string
  classes: {
    positive: ClassStats
    negative: ClassStats
    evasion: ClassStats
    advisory: ClassStats & {
      /** Advisory samples that raised a blocking crossing instead. */
      blocked: number
    }
  }
  /** Samples the judge had no judgement for (excluded from every rate). */
  unjudged: number
  /** Samples whose judge call failed (scored as not flagged). */
  failed: number
  /** Mann–Whitney AUROC over positive vs negative scores (scored judges). */
  auroc: number | null
  groups: GroupRow[]
  /** Blocking category → samples raising it, per class (category-aware). */
  categories: {
    positive: Record<string, number>
    negative: Record<string, number>
  }
  /** Advisory category → samples recording it, per class. */
  advisoryCategories: {
    positive: Record<string, number>
    negative: Record<string, number>
  }
  misses: SampleOutcome[]
  falseAlarms: SampleOutcome[]
  /** Dataset-specific counts (excluded records, skipped tool calls …). */
  notes: string[]
}
