/**
 * LUM-996 — injection-signal detector benchmark.
 *
 *   npx tsx scripts/analysis/lum996-injection-detector-bench/run.ts
 *     [--offline]            use the cache only, never the network
 *     [--cache-dir <dir>]    default: ./.cache next to this file (gitignored)
 *     [--out <file>]         default: ./results.json next to this file
 *
 * Fetches the public corpora (or reads them from the cache), builds the
 * Lumo-shaped benign corpus from the pinned commit, scores every sample with
 * production's `guardUntrustedContent(sanitizeField(text))`, and writes the
 * read-out. Deterministic: no timestamps, stable ordering.
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BENIGN_COMMIT, loadBenignCorpus, REPO_ROOT } from './benign'
import type { Rate } from './classify'
import {
  pinnedSample,
  pool,
  scoreSamples,
  summarizeDataset,
  type DatasetResult,
} from './evaluate'
import {
  DEFAULT_CACHE_DIR,
  loadPublicCorpus,
  sha256,
  type DatasetInfo,
} from './sources'

export interface RunArgs {
  offline: boolean
  cacheDir: string
  out: string
}

export function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = {
    offline: false,
    cacheDir: DEFAULT_CACHE_DIR,
    out: join(__dirname, 'results.json'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--offline') args.offline = true
    else if (a === '--cache-dir' && argv[i + 1]) args.cacheDir = argv[++i]!
    else if (a === '--out' && argv[i + 1]) args.out = argv[++i]!
    else throw new Error(`unknown argument: ${a}`)
  }
  return args
}

export const LUMO_BENIGN: DatasetInfo[] = [
  {
    id: 'lumo-markdown',
    label: 'benign',
    title:
      'Lumo repo markdown (docs, READMEs, skill references), heading-chunked',
    licence: 'repo-internal',
    url: `git show ${BENIGN_COMMIT}:<path>.md`,
    revision: BENIGN_COMMIT,
    quotable: true,
    note: 'Excludes the vendored third-party skill packs under .agents/.',
  },
  {
    id: 'lumo-commit-messages',
    label: 'benign',
    title: 'Lumo squash-merge commit bodies (PR title + description)',
    licence: 'repo-internal',
    url: `git log ${BENIGN_COMMIT} --no-merges`,
    revision: BENIGN_COMMIT,
    quotable: true,
  },
  {
    id: 'lumo-ui-strings',
    label: 'benign',
    title: 'Lumo en + zh-CN UI strings, 10 per sample',
    licence: 'repo-internal',
    url: `git show ${BENIGN_COMMIT}:lib/i18n/{en,zh-CN}.json`,
    revision: BENIGN_COMMIT,
    quotable: true,
  },
]

export const NOT_USED = [
  {
    dataset: 'hackaprompt/hackaprompt-dataset',
    why: 'Gated on Hugging Face behind a terms acceptance; not accepted on the team’s behalf.',
  },
  { dataset: 'PINT (Lakera)', why: 'Full set is not public.' },
  {
    dataset: 'Slack threads',
    why: 'No non-production source; production data is out of scope.',
  },
]

function fmtRate(r: Rate): string {
  if (r.rate === null) return 'n/a'
  const pct = (x: number | null): string => `${((x ?? 0) * 100).toFixed(1)}%`
  return `${pct(r.rate)} [${pct(r.lo)}, ${pct(r.hi)}]`
}

export function markdownTable(rows: DatasetResult[]): string {
  const lines = [
    '| Dataset | Kind | N | Flagged | Rate [95% Wilson CI] |',
    '| --- | --- | ---: | ---: | --- |',
  ]
  for (const r of rows)
    lines.push(
      `| ${r.id} | ${r.label === 'attack' ? 'recall' : 'FPR'} | ${r.flagged.n} | ${r.flagged.k} | ${fmtRate(r.flagged)} |`
    )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const pub = await loadPublicCorpus({
    cacheDir: args.cacheDir,
    offline: args.offline,
  })
  for (const d of pub.drift)
    process.stderr.write(
      `warning: upstream drift — ${d}; results may differ from the committed read-out\n`
    )

  const benign = loadBenignCorpus()
  const scored = scoreSamples([...pub.samples, ...benign])
  const infos = [...pub.datasets, ...LUMO_BENIGN]
  const quotable = infos.filter(d => d.quotable).map(d => d.id)
  const attackIds = infos.filter(d => d.label === 'attack').map(d => d.id)
  const publicBenignIds = pub.datasets
    .filter(d => d.label === 'benign')
    .map(d => d.id)
  const lumoBenignIds = LUMO_BENIGN.map(d => d.id)

  const datasets = infos.map(info => summarizeDataset(info, scored))
  const detectorFile = (p: string): string =>
    sha256(readFileSync(join(REPO_ROOT, p), 'utf8'))

  const results = {
    task: 'LUM-996',
    detector: {
      entry:
        'guardUntrustedContent(sanitizeField(text)) — flagged = signals.length > 0 || wrapperEscapes > 0',
      sourceSha256: {
        'shared/src/untrusted-content.ts': detectorFile(
          'shared/src/untrusted-content.ts'
        ),
        'shared/src/sanitize.ts': detectorFile('shared/src/sanitize.ts'),
      },
    },
    benignCommit: BENIGN_COMMIT,
    notUsed: NOT_USED,
    attacks: datasets.filter(d => d.label === 'attack'),
    benign: datasets.filter(d => d.label === 'benign'),
    pooled: {
      attacks: pool(scored, attackIds, 'attack', new Set(quotable)),
      publicBenign: pool(scored, publicBenignIds, 'benign', new Set(quotable)),
      lumoBenign: pool(scored, lumoBenignIds, 'benign', new Set(quotable)),
    },
    pinnedSample: pinnedSample(scored, quotable),
  }

  await writeFile(args.out, `${JSON.stringify(results, null, 2)}\n`)
  process.stdout.write(`${markdownTable(datasets)}\n\nwrote ${args.out}\n`)
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(1)
  })
}
