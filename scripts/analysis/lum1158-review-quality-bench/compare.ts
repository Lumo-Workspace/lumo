/**
 * LUM-1197 — compare two arms of Lumo runs (several judged tags each) on the
 * same PRs and say whether the difference is bigger than run-to-run noise.
 *
 *   npx tsx scripts/analysis/lum1158-review-quality-bench/compare.ts \
 *     --data <dir> --base lumo-run0,lumo-run1,lumo-run2 --variant v-run0,v-run1,v-run2 \
 *     [--fixes oss-03:A4,own-05:A2] [--iterations 4000] [--seed 1197] [--out compare.md]
 *
 * Per slice (oss, own): each run's P / R / F1 / noise per PR, each arm's mean
 * F1, SD, spread and the share of found fixes every run found, then the F1
 * difference with a paired PR × run bootstrap interval. `--fixes` lists the
 * fixes the change is meant to catch (pre-register them before the run) and
 * tests each one on its own (hits over runs, one-sided Fisher), Holm-adjusted
 * across the fixes. No verdict is printed unless both arms have ≥ 2 runs
 * (3 recommended). Free: reads judged.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { seededRandom, type JudgedPr, type PrScore } from './bench-lib'
import {
  armStats,
  bootstrapF1Delta,
  deltaVerdict,
  detectableDelta,
  foundByEveryRun,
  parseCount,
  targetFixTests,
  type TargetFix,
} from './variance-lib'

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T
const list = (s: string) =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)

const dataDir = opt('data')
const baseTags = list(opt('base'))
const variantTags = list(opt('variant'))
const targets: TargetFix[] = list(opt('fixes', '')).map(x => {
  const [prId, fixId] = x.split(':')
  if (!prId || !fixId)
    throw new Error(`--fixes entry ${x} is not <pr id>:<fix id>`)
  return { prId, fixId }
})
const iterations = parseCount('iterations', opt('iterations', '4000'), 100)
const seed = parseCount('seed', opt('seed', '1197'), 0)
const outFile = opt('out', '')

const meta = readJson<Record<string, { id: string; source: string }>>(
  path.join(dataDir, 'meta.json')
)
const judged = readJson<Record<string, Record<string, JudgedPr>>>(
  path.join(dataDir, 'judged.json')
)
for (const t of [...baseTags, ...variantTags])
  if (!judged[t]) throw new Error(`tag ${t} is not in ${dataDir}/judged.json`)

const f = (x: number, d = 1) => x.toFixed(d)
const lines: string[] = []
const out = (s = '') => lines.push(s)

for (const slice of ['oss', 'own'] as const) {
  const tags = [...baseTags, ...variantTags]
  const urls = Object.entries(meta)
    .filter(([, m]) => m.source === slice)
    .map(([u]) => u)
  const usable = urls.filter(u =>
    tags.every(t => judged[t]![u] && !judged[t]![u]!.skipped)
  )
  if (!usable.length) continue
  usable.sort((a, b) => meta[a]!.id.localeCompare(meta[b]!.id))
  const ids = usable.map(u => meta[u]!.id)
  const arm = (ts: string[]): PrScore[][] =>
    ts.map(t => usable.map(u => judged[t]![u]!.score))
  const base = arm(baseTags)
  const variant = arm(variantTags)

  out(`## ${slice} — ${usable.length} PRs`)
  if (usable.length < urls.length)
    out(
      `\nLeft out (missing or skipped in some tag): ${urls.length - usable.length} PRs.`
    )
  out('\n| arm | tag | P | R | F1 | noise/PR |')
  out('| --- | --- | --- | --- | --- | --- |')
  const stats: Record<string, ReturnType<typeof armStats>> = {}
  for (const [name, ts, runs] of [
    ['base', baseTags, base],
    ['variant', variantTags, variant],
  ] as const) {
    const st = armStats(runs)
    stats[name] = st
    ts.forEach((t, i) =>
      out(
        `| ${name} | ${t} | ${f(st.precision[i]!)} | ${f(st.recall[i]!)} | ${f(st.f1[i]!)} | ${f(st.noisePerPr[i]!, 2)} |`
      )
    )
  }
  out('\n| arm | runs | mean F1 | SD | spread | found by every run |')
  out('| --- | --- | --- | --- | --- | --- |')
  for (const [name, runs] of [
    ['base', base],
    ['variant', variant],
  ] as const) {
    const st = stats[name]!
    const agree = foundByEveryRun(runs)
    const share = agree.any
      ? `${agree.every}/${agree.any} = ${f((100 * agree.every) / agree.any, 0)}%`
      : '—'
    out(
      `| ${name} | ${runs.length} | ${f(st.mean)} | ${f(st.sd)} | ${f(st.spread)} | ${share} |`
    )
  }
  const d = bootstrapF1Delta(base, variant, {
    iterations,
    rand: seededRandom(seed),
  })
  const sds = [stats.base!, stats.variant!].filter(s => s.f1.length > 1)
  const sdRun = sds.length
    ? Math.sqrt(sds.reduce((a, s) => a + s.sd ** 2, 0) / sds.length)
    : NaN
  const n = Math.min(base.length, variant.length)
  out(
    `\nF1 variant − base: ${d.delta >= 0 ? '+' : ''}${f(d.delta)} (95% interval ${f(d.lo)} … ${f(d.hi)}; variant ahead in ${f(100 * d.pBetter, 0)}% of draws) — ${deltaVerdict(d, base.length, variant.length)}.`
  )
  if (Number.isFinite(sdRun) && n >= 2)
    out(
      `Run SD here ≈ ${f(sdRun)} F1; with ${n} runs per arm only a difference of about ${f(detectableDelta(sdRun, n))} F1 is reliably detectable.`
    )

  const inSlice = targets.filter(t => t.prId.startsWith(`${slice}-`))
  if (inSlice.length) {
    const t = targetFixTests(base, variant, ids, inSlice)
    out(
      '\n| target fix | base hits | variant hits | p (one-sided Fisher) | p (Holm) |'
    )
    out('| --- | --- | --- | --- | --- |')
    for (const x of t.perFix)
      out(
        `| ${x.prId}:${x.fixId} | ${x.baseHits}/${base.length} | ${x.variantHits}/${variant.length} | ${x.p.toFixed(3)} | ${x.pHolm.toFixed(3)} |`
      )
    const caught = t.perFix.filter(x => x.pHolm < 0.05)
    out(
      `\nTarget fixes caught beyond run noise (Holm p < 0.05): ${caught.length}/${t.perFix.length}${caught.length ? ` (${caught.map(x => `${x.prId}:${x.fixId}`).join(', ')})` : ''}. Each fix is tested on its own runs; fixes of one run are not independent, so they are never pooled.`
    )
    if (t.missing.length) out(`Not in this PR set: ${t.missing.join(', ')}.`)
  }
  out()
}

const report = `${lines.join('\n')}\n`
if (outFile) writeFileSync(outFile, report)
process.stdout.write(report)
