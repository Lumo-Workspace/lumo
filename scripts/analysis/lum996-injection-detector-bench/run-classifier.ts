/**
 * LUM-1007 — regex vs a local ML classifier on the LUM-996 bench.
 *
 *   npx tsx scripts/analysis/lum996-injection-detector-bench/run-classifier.ts \
 *     --python <venv>/bin/python
 *     [--offline]            use the corpus cache only, never the network
 *     [--cache-dir <dir>]    default: ./.cache next to this file (gitignored)
 *     [--out <file>]         default: ./results-classifier.json next to this file
 *     [--rescore]            ignore cached classifier scores
 *
 * Same corpora and split as run.ts. Writes results-classifier.json (context +
 * aggregates) and results-classifier.rows.jsonl.gz (per-sample detail) next
 * to `--out`. Leaves results.json alone and refuses to write if its own regex
 * numbers differ from the committed results.json.
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { BENIGN_COMMIT, loadBenignCorpus } from './benign'
import { detectLang, type Rate } from './classify'
import {
  CLASSIFIER_MODELS,
  runClassifier,
  THRESHOLD_GRID,
  type ClassifierModel,
  type ClassifierScore,
} from './classifier'
import type { ArmReport, BenchRow, Pools, SliceReport } from './combine'
import {
  buildAggregates,
  DETAIL_FILE,
  detailJsonl,
  encodeDetail,
  formatReadout,
  sha256Hex,
  type DetailRow,
  type ReadoutContext,
} from './readout'
import {
  PLAIN_SLICE_ID,
  plainSliceItems,
  plainSliceSamples,
} from './plain-agent-addressed'
import { LUMO_BENIGN } from './run'
import { scoreText } from './score'
import { splitOf } from './split'
import {
  DEFAULT_CACHE_DIR,
  loadPublicCorpus,
  sha256,
  type Sample,
} from './sources'

/** LUM-998 decision: Lumo-benign FPR must stay ≤ 1.0%. */
export const FPR_BOUND = 0.01

export interface ClassifierRunArgs {
  python: string
  offline: boolean
  rescore: boolean
  cacheDir: string
  out: string
}

export function parseClassifierArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ClassifierRunArgs {
  const args: ClassifierRunArgs = {
    python: env.LUM1007_PYTHON ?? 'python3',
    offline: false,
    rescore: false,
    cacheDir: DEFAULT_CACHE_DIR,
    out: join(__dirname, 'results-classifier.json'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--offline') args.offline = true
    else if (a === '--rescore') args.rescore = true
    else if (a === '--python' || a === '--cache-dir' || a === '--out') {
      const value = argv[++i]
      if (!value) throw new Error(`${a} needs a value`)
      if (a === '--python') args.python = value
      else if (a === '--cache-dir') args.cacheDir = value
      else args.out = value
    } else throw new Error(`unknown argument: ${a}`)
  }
  return args
}

/** Join regex verdicts + classifier scores into bench rows. */
export function buildRows(
  samples: Array<Sample & { regex: boolean; regexMs: number }>,
  scores: Map<string, ClassifierScore>
): BenchRow[] {
  return samples.map(s => {
    const c = scores.get(sha256(s.text))
    if (!c) throw new Error(`no classifier score for ${s.dataset} ${s.ref}`)
    return {
      dataset: s.dataset,
      ref: s.ref,
      label: s.label,
      lang: detectLang(s.text),
      split: splitOf(s),
      regex: s.regex,
      regexMs: s.regexMs,
      prob: c.prob,
      chunks: c.chunks,
      clfMs: c.ms,
    }
  })
}

interface CommittedRate {
  k: number
  n: number
}

/**
 * The regex arm must reproduce the committed LUM-996/998 numbers exactly
 * (pooled + per split); otherwise the comparison is not on the same footing.
 */
export function regexMismatches(
  rows: BenchRow[],
  pools: Pools,
  committed: {
    pooled: Record<
      'attacks' | 'lumoBenign' | 'publicBenign',
      { flagged: CommittedRate }
    >
    split: Record<
      'train' | 'heldout',
      Record<'attacks' | 'lumoBenign' | 'publicBenign', CommittedRate>
    >
  }
): string[] {
  const out: string[] = []
  const count = (ids: string[], split?: 'train' | 'heldout'): CommittedRate => {
    const mine = rows.filter(
      r => ids.includes(r.dataset) && (split === undefined || r.split === split)
    )
    return { k: mine.filter(r => r.regex).length, n: mine.length }
  }
  for (const pool of ['attacks', 'lumoBenign', 'publicBenign'] as const) {
    const checks: Array<[string, CommittedRate, CommittedRate]> = [
      [`pooled.${pool}`, count(pools[pool]), committed.pooled[pool].flagged],
      [
        `train.${pool}`,
        count(pools[pool], 'train'),
        committed.split.train[pool],
      ],
      [
        `heldout.${pool}`,
        count(pools[pool], 'heldout'),
        committed.split.heldout[pool],
      ],
    ]
    for (const [name, got, want] of checks)
      if (got.k !== want.k || got.n !== want.n)
        out.push(
          `${name}: got ${got.k}/${got.n}, results.json has ${want.k}/${want.n}`
        )
  }
  return out
}

export function fmtRate(r: Rate): string {
  if (r.rate === null) return 'n/a'
  const pct = (x: number | null): string => `${((x ?? 0) * 100).toFixed(1)}%`
  return `${pct(r.rate)} [${pct(r.lo)}, ${pct(r.hi)}]`
}

/** Held-out comparison table (markdown), one row per arm. */
export function comparisonTable(
  reports: ArmReport[],
  attackIds: string[]
): string {
  const head = [
    'Arm',
    'Attacks (held-out)',
    ...attackIds,
    'en',
    'zh',
    'de',
    'Lumo-benign FPR',
    'Public-benign FPR',
    'p50 / p95 ms',
  ]
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ]
  const pct = (r: Rate | undefined): string =>
    r && r.rate !== null ? `${(r.rate * 100).toFixed(1)}%` : '—'
  for (const r of reports) {
    const mark = r.arm.chosen === 'train' ? ' ★' : ''
    lines.push(
      `| ${r.arm.id}${mark} | ${fmtRate(r.attacks)} | ${attackIds
        .map(id => pct(r.attacksByDataset[id]))
        .join(
          ' | '
        )} | ${pct(r.attacksByLanguage.en)} | ${pct(r.attacksByLanguage.zh)} | ${pct(
        r.attacksByLanguage.de
      )} | ${fmtRate(r.lumoBenign)}${r.withinFprBound ? '' : ' ✗'} | ${fmtRate(r.publicBenign)} | ${
        r.latencyMs.p50
      } / ${r.latencyMs.p95} |`
    )
  }
  return lines.join('\n')
}

/** plain-agent-addressed slice table (markdown), one row per arm. */
export function sliceTable(reports: SliceReport[]): string {
  const lines = [
    '| Arm | Slice (all) | EN | ZH | LUM-999 payloads flagged |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const r of reports) {
    const v = Object.values(r.verbatim)
    lines.push(
      `| ${r.arm.id}${r.arm.chosen === 'train' ? ' ★' : ''} | ${fmtRate(r.all)} | ${
        r.byLanguage.en ? fmtRate(r.byLanguage.en) : '—'
      } | ${r.byLanguage.zh ? fmtRate(r.byLanguage.zh) : '—'} | ${v.filter(Boolean).length}/${v.length} |`
    )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = parseClassifierArgs(process.argv.slice(2))
  const pub = await loadPublicCorpus({
    cacheDir: args.cacheDir,
    offline: args.offline,
  })
  for (const d of pub.drift)
    process.stderr.write(`warning: upstream drift — ${d}; results may differ\n`)
  // The plain-agent-addressed slice is scored with everything else but sits
  // outside every pool: no pooled recall, no threshold choice.
  const samples = [
    ...pub.samples,
    ...loadBenignCorpus(),
    ...plainSliceSamples(),
  ]
  const sliceItems = plainSliceItems()

  const regexScored = samples.map(s => {
    const t0 = performance.now()
    const flagged = scoreText(s.text).flagged
    return { ...s, regex: flagged, regexMs: performance.now() - t0 }
  })

  const infos = [...pub.datasets, ...LUMO_BENIGN]
  const ctx: ReadoutContext = {
    fprBound: FPR_BOUND,
    pools: {
      attacks: infos.filter(d => d.label === 'attack').map(d => d.id),
      publicBenign: pub.datasets
        .filter(d => d.label === 'benign')
        .map(d => d.id),
      lumoBenign: LUMO_BENIGN.map(d => d.id),
    },
    datasetOrder: infos.map(d => d.id),
    thresholdGrid: [...THRESHOLD_GRID],
    models: CLASSIFIER_MODELS.map(m => ({
      id: m.id,
      maxTokens: m.maxTokens,
      reportThresholds: [...m.reportThresholds],
    })),
    slice: {
      id: PLAIN_SLICE_ID,
      langByRef: Object.fromEntries(sliceItems.map(i => [i.ref, i.lang])),
      verbatimRefs: sliceItems
        .filter(i => i.origin === 'lum999')
        .map(i => i.ref),
    },
  }
  const committed = JSON.parse(
    readFileSync(join(__dirname, 'results.json'), 'utf8')
  )

  const detail: DetailRow[] = []
  for (const model of CLASSIFIER_MODELS as ClassifierModel[]) {
    process.stderr.write(
      `scoring ${samples.length} samples with ${model.repo} …\n`
    )
    const scores = await runClassifier(
      model,
      samples.map(s => s.text),
      { python: args.python, cacheDir: args.cacheDir, rescore: args.rescore }
    )
    const rows = buildRows(regexScored, scores)
    const bad = regexMismatches(rows, ctx.pools, committed)
    if (bad.length > 0)
      throw new Error(
        `regex arm does not match results.json:\n  ${bad.join('\n  ')}`
      )
    detail.push(...rows.map(r => ({ model: model.id, ...r })))
  }

  const gz = encodeDetail(detail)
  const results = {
    task: 'LUM-1007',
    note: 'Regex numbers are recomputed and asserted equal to results.json (LUM-996/998), not copied. `aggregates` is rebuilt from the per-sample detail file by buildAggregates (readout.ts); the jest suite checks that. Latency fields are wall-clock measurements and vary between runs/machines; everything else is deterministic for a given cache.',
    fprBound: FPR_BOUND,
    benignCommit: BENIGN_COMMIT,
    machine: {
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCores: cpus().length,
    },
    pythonDeps: readFileSync(
      join(__dirname, 'classifier', 'requirements.txt'),
      'utf8'
    )
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#')),
    detail: {
      file: DETAIL_FILE,
      rows: detail.length,
      sha256Uncompressed: sha256Hex(detailJsonl(detail)),
      fields: Object.keys(detail[0] ?? {}),
    },
    context: ctx,
    models: CLASSIFIER_MODELS.map(m => ({
      id: m.id,
      repo: m.repo,
      revision: m.revision,
      licence: m.licence,
      gated: m.gated,
      runtime:
        'onnxruntime CPUExecutionProvider, batch size 1 (classifier/score_onnx.py)',
      thresholdRule: `lowest grid value with TRAIN Lumo-benign FPR ≤ ${FPR_BOUND * 100}%`,
      chunkingRule: `texts over ${m.maxTokens - 2} content tokens are split into consecutive ${
        m.maxTokens - 2
      }-token windows; any chunk flagged → flagged (max probability)`,
    })),
    plainAgentAddressedSlice: {
      id: PLAIN_SLICE_ID,
      n: sliceItems.length,
      byOrigin: {
        lum999: sliceItems.filter(i => i.origin === 'lum999').length,
        handwrittenEn: sliceItems.filter(
          i => i.origin === 'handwritten' && i.lang === 'en'
        ).length,
        handwrittenZh: sliceItems.filter(
          i => i.origin === 'handwritten' && i.lang === 'zh'
        ).length,
      },
      note: 'Hand-written before any scoring; outside every pool and never used for threshold choice (pure held-out). See plain-agent-addressed.ts.',
    },
    aggregates: buildAggregates(detail, ctx),
  }
  const detailOut = join(dirname(args.out), DETAIL_FILE)
  await writeFile(detailOut, gz)
  await writeFile(args.out, formatReadout(results))
  const agg = results.aggregates
  const table = comparisonTable(
    [agg.regex.heldout, ...agg.models.flatMap(m => m.heldout)],
    ctx.pools.attacks
  )
  const slice = sliceTable([
    agg.regex.plainAgentAddressed,
    ...agg.models.flatMap(m => m.plainAgentAddressed),
  ])
  process.stdout.write(
    `${table}\n\n${slice}\n\nwrote ${args.out}\nwrote ${detailOut}\n`
  )
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(1)
  })
}
