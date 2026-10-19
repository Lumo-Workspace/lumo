/**
 * LUM-1158 — print the benchmark report (markdown) and the run's token use.
 *
 *   npx tsx scripts/analysis/lum1158-review-quality-bench/score.ts \
 *     --data <dir> --tags lumo-run0,lumo-run1 [--out report.md]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { JudgedPr, PrLabels } from './bench-lib'
import { buildReport } from './report'

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T

const dataDir = opt('data')
const lumoTags = opt('tags').split(',').filter(Boolean)
const outFile = opt('out', '')

const meta = readJson<Record<string, { id: string; source: string }>>(
  path.join(dataDir, 'meta.json')
)
const judged = readJson<Record<string, Record<string, JudgedPr>>>(
  path.join(dataDir, 'judged.json')
)
const labelsFile = path.join(dataDir, 'labels.json')
const labels: Record<string, PrLabels> = existsSync(labelsFile)
  ? readJson(labelsFile)
  : {}

let input = 0
let output = 0
for (const l of Object.values(labels))
  for (const u of [l.usage.truth, l.usage.reference]) {
    input += u?.inputTokens ?? 0
    output += u?.outputTokens ?? 0
  }
for (const [tag, rows] of Object.entries(judged)) {
  if (tag === 'params') continue
  for (const r of Object.values(rows)) {
    input += r.usage?.inputTokens ?? 0
    output += r.usage?.outputTokens ?? 0
  }
}

const report = `${buildReport({ meta, judged, lumoTags })}\nLabel + judge tokens: ${input} in / ${output} out (Lumo's own review/verifier/ranker tokens are in their result files).\n`
if (outFile) writeFileSync(outFile, report)
process.stdout.write(report)
