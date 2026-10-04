/**
 * LUM-984 — run one dataset × judge and score it.
 *
 * Threshold discipline (LUM-965): a scored judge's threshold is either given
 * explicitly (`--threshold`, the value frozen on tune) or chosen on the
 * dataset's TUNE split — never on the samples being reported. A dataset
 * without a tune split needs the explicit value.
 */
import { scoreRun } from './score'
import { tuneThreshold } from './stats'
import type { EvalReport, EvalSample, EvalUnit, Judge, Verdict } from './types'

export interface LoadedDataset {
  samples: EvalSample[]
  /** e.g. `split=holdout, history=on` — printed in the report header. */
  options: string
  /** The dataset's tune split, when it has one (threshold selection only). */
  tune?: EvalSample[]
  /** Dataset-specific counts (excluded records, skipped tool calls …). */
  notes: string[]
}

export interface DatasetLoadOptions {
  /** Override of the dataset's default data location (dir or file). */
  data?: string | undefined
  split?: string | undefined
  history: boolean
  /** Allow network: fetch a missing cache. Off by default. */
  download: boolean
  log: (line: string) => void
}

export interface DatasetAdapter {
  id: string
  describe: string
  unit: EvalUnit
  /** Where the data comes from and how to fetch it (printed by --list). */
  source: string
  splits?: readonly string[]
  /** Dataset-only flags this adapter accepts (e.g. `--history`). */
  flags?: readonly string[]
  load(opts: DatasetLoadOptions): Promise<LoadedDataset>
  /** Extra text after the generic report (a legacy view kept for parity). */
  detail?(
    samples: EvalSample[],
    verdicts: Map<string, Verdict | undefined>
  ): string
  /** A failure message makes the run exit non-zero (e.g. the recall guard). */
  guard?(report: EvalReport): string | null
}

export interface RunResult {
  report: EvalReport
  detail: string
  guardFailure: string | null
  verdicts: Map<string, Verdict | undefined>
}

async function judgeAll(
  judge: Judge,
  samples: EvalSample[]
): Promise<Map<string, Verdict | undefined>> {
  const out = new Map<string, Verdict | undefined>()
  for (const s of samples) {
    if (out.has(s.id)) throw new Error(`duplicate sample id ${s.id}`)
    out.set(s.id, await judge.judge(s))
  }
  return out
}

/** Pick the threshold and say where it came from. */
export async function chooseThreshold(
  dataset: Pick<DatasetAdapter, 'id'>,
  loaded: Pick<LoadedDataset, 'tune'>,
  judge: Judge,
  explicit: number | undefined
): Promise<{ threshold: number; source: string }> {
  if (!judge.scored) {
    if (explicit !== undefined) {
      throw new Error(
        `--threshold does not apply to ${judge.id}: it flags on any blocking crossing`
      )
    }
    return {
      threshold: 0.5,
      source: 'rule judge — flagged when any event raises a blocking crossing',
    }
  }
  if (explicit !== undefined) {
    return {
      threshold: explicit,
      source: 'given with --threshold (must be the value frozen on tune)',
    }
  }
  if (!loaded.tune) {
    throw new Error(
      `${dataset.id} has no tune split to choose a threshold on — pass the threshold frozen on tune with --threshold (e.g. --threshold 0.4 for the LUM-965 whole-trajectory monitor)`
    )
  }
  const verdicts = await judgeAll(judge, loaded.tune)
  const scores = loaded.tune.flatMap(s => {
    const v = verdicts.get(s.id)
    if (!v || s.label === 'advisory' || s.evasion) return []
    return [{ label: s.label, score: v.score ?? 0 }]
  })
  if (scores.length === 0) {
    throw new Error(
      `the judge has no judgements on the ${dataset.id} tune split — pass --threshold`
    )
  }
  return {
    threshold: tuneThreshold(scores),
    source: `chosen on the tune split (${scores.length} judged): lowest 0.05-grid t with ≤5% false positives`,
  }
}

export async function runEval(opts: {
  dataset: DatasetAdapter
  loaded: LoadedDataset
  judge: Judge
  threshold?: number | undefined
}): Promise<RunResult> {
  const { dataset, loaded, judge } = opts
  const { threshold, source } = await chooseThreshold(
    dataset,
    loaded,
    judge,
    opts.threshold
  )
  const verdicts = await judgeAll(judge, loaded.samples)
  const report = scoreRun({
    dataset: dataset.id,
    datasetOptions: loaded.options,
    judge,
    unit: dataset.unit,
    threshold,
    thresholdSource: source,
    samples: loaded.samples,
    verdicts,
    notes: loaded.notes,
  })
  return {
    report,
    detail: dataset.detail ? dataset.detail(loaded.samples, verdicts) : '',
    guardFailure: dataset.guard ? dataset.guard(report) : null,
    verdicts,
  }
}
