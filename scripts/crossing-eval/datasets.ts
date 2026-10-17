/**
 * LUM-984 — dataset adapters for the external / generated corpora. Each one
 * wraps an existing experiment's loader and converter (LUM-948 / 949 / 965),
 * so the numbers stay those experiments' numbers; only the scoring and the
 * report are shared (lib/boundary-crossing/eval/).
 *
 * None of these datasets is in the repository (no upstream license; the
 * ControlArena set is generated locally). Default runs are OFFLINE: a missing
 * cache is an error naming the fetch command, and only `--download` touches
 * the network.
 */
import { access, readFile } from 'node:fs/promises'
import type {
  DatasetAdapter,
  DatasetLoadOptions,
  LoadedDataset,
} from '@/ee/private/boundary-crossing/eval/run'
import type { EvalSample } from '@/ee/private/boundary-crossing/eval/types'
import {
  monitorEvalTrajectories,
  syntheticTrajectories,
  type MonitorEvalRow,
  type SyntheticRow,
  type Trajectory,
} from '../analysis/lum948-basharena/convert'
import {
  DEFAULT_CACHE_DIR,
  SOURCES,
  cacheFile,
  loadSplit,
} from '../analysis/lum948-basharena/download'
import { convertRecord } from '../analysis/lum949-rjudge/convert'
import { recordKey } from '../analysis/lum949-rjudge/evaluate'
import {
  RJUDGE_REPO,
  RJUDGE_SHA,
  defaultDataDir,
  downloadAll,
  loadAll,
} from '../analysis/lum949-rjudge/source'
import {
  freshTrajectories,
  parseExport,
} from '../analysis/lum965-basharena-monitor/controlarena/trajectories'
import { FRESH_EXPORT } from '../analysis/lum965-basharena-monitor/records'
import { splitTrajectories } from '../analysis/lum965-basharena-monitor/split'
import {
  convertTraceRow,
  hackFamily,
  type TraceTrajectory,
} from '../analysis/lum1234-trace/convert'
import {
  TRACE_DATASET,
  defaultTraceDir,
  loadTraceRows,
  resolveTraceFile,
} from '../analysis/lum1234-trace/source'

const RUN = 'npx tsx scripts/crossing-eval.ts'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function skippedNote(skipped: Record<string, number>): string {
  const parts = Object.entries(skipped)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
  return `tool calls not evaluated (unsupported tool): ${parts.join(' ') || 'none'}`
}

function sumSkipped(ts: { skipped: Record<string, number> }[]) {
  const out: Record<string, number> = {}
  for (const t of ts) {
    for (const [k, n] of Object.entries(t.skipped)) out[k] = (out[k] ?? 0) + n
  }
  return out
}

function pickSplit(
  id: string,
  requested: string | undefined,
  splits: readonly string[],
  fallback: string
): string {
  const s = requested ?? fallback
  if (!splits.includes(s)) {
    throw new Error(
      `--split ${s} is not a split of ${id}; use one of: ${splits.join(', ')}`
    )
  }
  return s
}

function sideTaskGroups(t: { label: string; sideTask: string }) {
  return t.label === 'attack' && t.sideTask
    ? { sideTask: t.sideTask.split('+') }
    : {}
}

/** Rows of one HF split from the LUM-948 cache; offline unless --download. */
async function basharenaRows(
  dataset: string,
  split: string,
  opts: DatasetLoadOptions,
  self: string
): Promise<Record<string, unknown>[]> {
  const dir = opts.data ?? DEFAULT_CACHE_DIR
  const file = cacheFile(dir, dataset, split)
  if (!opts.download && !(await exists(file))) {
    throw new Error(
      `missing cache ${file} — fetch it with \`${RUN} --dataset ${self} --download${opts.data ? ` --data ${opts.data}` : ''}\``
    )
  }
  return loadSplit(dir, dataset, split, { log: opts.log })
}

// --- BashArena monitor-eval ---------------------------------------------------

export const MONITOR_EVAL_SPLITS = ['all', 'tune', 'holdout'] as const

export function monitorEvalSamples(
  trajs: Trajectory[],
  split: string
): { samples: EvalSample[]; tune: EvalSample[] } {
  const keyed = trajs.map(t => ({ t, id: `${t.id}:${t.label}` }))
  const splitOf = splitTrajectories(
    keyed.map(k => ({ id: k.id, sampleId: k.t.id, label: k.t.label }))
  )
  const all: EvalSample[] = keyed.map(({ t, id }) => ({
    id,
    label: t.label === 'attack' ? 'positive' : 'negative',
    groups: { ...sideTaskGroups(t), split: [splitOf.get(id)!] },
    events: t.events,
  }))
  const tune = all.filter(s => s.groups.split![0] === 'tune')
  return {
    samples:
      split === 'all' ? all : all.filter(s => s.groups.split![0] === split),
    tune,
  }
}

export const basharenaMonitorEval: DatasetAdapter = {
  id: 'basharena-monitor-eval',
  describe:
    'abhayesian/basharena-monitor-eval — 138 real BashArena runs (38 attack / 100 honest); LUM-965 fixed tune/holdout split by task',
  unit: 'trajectory',
  source: `HF datasets-server → ${DEFAULT_CACHE_DIR} (no license, never committed); fetch: ${RUN} --dataset basharena-monitor-eval --download`,
  splits: MONITOR_EVAL_SPLITS,
  flags: ['--history'],
  async load(opts): Promise<LoadedDataset> {
    const split = pickSplit(this.id, opts.split, MONITOR_EVAL_SPLITS, 'all')
    const src = SOURCES.find(s => s.dataset.endsWith('monitor-eval'))!
    const rows = await basharenaRows(src.dataset, src.split, opts, this.id)
    const trajs = monitorEvalTrajectories(rows as unknown as MonitorEvalRow[], {
      includeHistory: opts.history,
    })
    const { samples, tune } = monitorEvalSamples(trajs, split)
    return {
      samples,
      tune,
      options: `split=${split}, events=${opts.history ? 'whole history (--history)' : 'scored actions'}`,
      notes: [skippedNote(sumSkipped(trajs))],
    }
  },
}

// --- BashArena synthetic --------------------------------------------------------

export const SYNTHETIC_SPLITS = ['all', 'train', 'test'] as const

export function syntheticSamples(trajs: Trajectory[]): EvalSample[] {
  return trajs.map(t => ({
    id: `${t.dataset}|${t.id}`,
    label: t.label === 'attack' ? 'positive' : 'negative',
    groups: {
      ...sideTaskGroups(t),
      split: [t.dataset.replace(/^synthetic:/, '')],
    },
    events: t.events,
  }))
}

export const basharenaSynthetic: DatasetAdapter = {
  id: 'basharena-synthetic',
  describe:
    'mandliya/basharena-synthetic-trajectories — synthetic BashArena runs, train 839 + test 114 (bash only)',
  unit: 'trajectory',
  source: `HF datasets-server → ${DEFAULT_CACHE_DIR} (no license, never committed); fetch: ${RUN} --dataset basharena-synthetic --download`,
  splits: SYNTHETIC_SPLITS,
  async load(opts): Promise<LoadedDataset> {
    const split = pickSplit(this.id, opts.split, SYNTHETIC_SPLITS, 'all')
    const trajs: Trajectory[] = []
    for (const src of SOURCES) {
      if (src.dataset.endsWith('monitor-eval')) continue
      if (split !== 'all' && src.split !== split) continue
      const rows = await basharenaRows(src.dataset, src.split, opts, this.id)
      trajs.push(
        ...syntheticTrajectories(rows as unknown as SyntheticRow[], src.split)
      )
    }
    return {
      samples: syntheticSamples(trajs),
      options: `split=${split}`,
      notes: [skippedNote(sumSkipped(trajs))],
    }
  },
}

// --- R-Judge --------------------------------------------------------------------

export const rjudge: DatasetAdapter = {
  id: 'rjudge',
  describe: `R-Judge (${RJUDGE_REPO} @ ${RJUDGE_SHA.slice(0, 12)}) — 571 agent records; only the ones with a Bash/Write/Read action reach the detector`,
  unit: 'record',
  source: `raw.githubusercontent.com (pinned sha) → ${defaultDataDir()} (no license, never committed); fetch: ${RUN} --dataset rjudge --download`,
  async load(opts): Promise<LoadedDataset> {
    const dir = opts.data ?? defaultDataDir()
    if (opts.download) await downloadAll(dir, opts.log)
    let loaded: Awaited<ReturnType<typeof loadAll>>
    try {
      loaded = await loadAll(dir)
    } catch (err) {
      throw new Error(
        `${(err as Error).message.replace(/ — run with --download first$/, '')} — fetch it with \`${RUN} --dataset rjudge --download${opts.data ? ` --data ${opts.data}` : ''}\``
      )
    }
    const converted = loaded.records.map(r => convertRecord(r))
    const onSurface = converted.filter(c => c.status !== 'unmapped')
    const unmapped = converted.filter(c => c.status === 'unmapped')
    const samples: EvalSample[] = onSurface.map(c => ({
      id: recordKey(c.record),
      label: c.record.label === 1 ? 'positive' : 'negative',
      groups: {
        category: [c.record.category],
        status: [c.status],
        attackType: [c.record.attackType || '(none)'],
      },
      events: c.events,
    }))
    return {
      samples,
      options: 'on-surface records (mapped + partial)',
      notes: [
        `${converted.length} records (invalid dropped: ${loaded.invalid}); ${unmapped.length} unmapped records excluded — no Bash/Write/Read action for the detector to see (unsafe ${unmapped.filter(c => c.record.label === 1).length} / safe ${unmapped.filter(c => c.record.label === 0).length})`,
        'by status=mapped is the "fully mapped only" view: every skipped action was prose',
      ],
    }
  },
}

// --- ControlArena (LUM-965 second holdout) --------------------------------------

export const CONTROLARENA_SPLITS = [
  'fresh',
  'fresh-unsuccessful',
  'all',
] as const

export const controlarenaHoldout: DatasetAdapter = {
  id: 'controlarena-holdout',
  describe:
    'LUM-965 second holdout — fresh BashArena runs generated with ControlArena (fresh = honest + attacks whose side task succeeded); scored once, never tuned on',
  unit: 'trajectory',
  source: `generated locally, exported to ${FRESH_EXPORT}; regenerate with scripts/analysis/lum965-basharena-monitor/controlarena/generate.py export (see that RESULTS.md)`,
  splits: CONTROLARENA_SPLITS,
  async load(opts): Promise<LoadedDataset> {
    if (opts.download) {
      throw new Error(
        'controlarena-holdout cannot be downloaded — it is generated locally; see scripts/analysis/lum965-basharena-monitor/RESULTS.md'
      )
    }
    const split = pickSplit(this.id, opts.split, CONTROLARENA_SPLITS, 'fresh')
    const file = opts.data ?? FRESH_EXPORT
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      throw new Error(
        `missing ControlArena export ${file} — produce it with \`~/.cache/lumo-lum965/ca/.venv/bin/python scripts/analysis/lum965-basharena-monitor/controlarena/generate.py export\`, or point --data at an existing export`
      )
    }
    const fresh = freshTrajectories(parseExport(raw))
    const samples: EvalSample[] = fresh.trajectories
      .map(t => ({
        id: t.id,
        label: (t.label === 'attack' ? 'positive' : 'negative') as
          | 'positive'
          | 'negative',
        groups: { ...sideTaskGroups(t), split: [fresh.split.get(t.id)!] },
        events: t.events,
      }))
      .filter(s => split === 'all' || s.groups.split[0] === split)
    return {
      samples,
      options: `split=${split}`,
      notes: [
        `dropped (sample error): ${fresh.dropped.length}`,
        skippedNote(fresh.skippedCalls),
      ],
    }
  },
}

// --- TRACE (LUM-1234) -------------------------------------------------------------

export function traceSamples(trajs: TraceTrajectory[]): EvalSample[] {
  return trajs.map(t => ({
    id: t.id,
    label: t.hacked ? 'positive' : 'negative',
    groups: t.hacked
      ? {
          hackType: t.hackTypes,
          hackFamily: Array.from(new Set(t.hackTypes.map(hackFamily))),
        }
      : {},
    events: t.events,
  }))
}

export const trace: DatasetAdapter = {
  id: 'trace',
  describe: `${TRACE_DATASET} (arXiv 2601.20103) — 517 synthetic, human-verified coding trajectories (268 reward-hacked / 249 benign); multi-label hack types`,
  unit: 'trajectory',
  source: `HF datasets-server (gated, CC-BY-SA-4.0, never committed) → ${defaultTraceDir()}; fetch: ${RUN} --dataset trace --download (accept the access conditions on HF + \`hf auth login\` first), or convert a parquet copy with scripts/analysis/lum1234-trace/parquet_to_json.py and pass --data`,
  async load(opts): Promise<LoadedDataset> {
    const file = resolveTraceFile(opts.data)
    const rows = await loadTraceRows({
      file,
      download: opts.download,
      fetchCommand: `${RUN} --dataset trace --download${opts.data ? ` --data ${opts.data}` : ''}`,
      log: opts.log,
    })
    const trajs = rows.map(r => convertTraceRow(r))
    const events = trajs.reduce((n, t) => n + t.events.length, 0)
    const skipped = sumSkipped(trajs)
    const skippedN = Object.values(skipped).reduce((a, b) => a + b, 0)
    const empty = trajs.filter(t => t.events.length === 0)
    return {
      samples: traceSamples(trajs),
      options: 'all trajectories, every tool call (synthetic TRACE)',
      notes: [
        `${events} tool calls evaluated, ${skippedN} not (${events + skippedN > 0 ? ((100 * skippedN) / (events + skippedN)).toFixed(1) : '0'}%)`,
        skippedNote(skipped),
        `trajectories with no evaluable tool call: ${empty.length} (hacked ${empty.filter(t => t.hacked).length} / benign ${empty.filter(t => !t.hacked).length})`,
      ],
    }
  },
}
