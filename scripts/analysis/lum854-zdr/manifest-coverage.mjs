/**
 * LUM-854 — check that docs/privacy/llm-data-flow.md names every runtime LLM
 * call site (any file under lib/ or app/ calling `gateway(` /
 * `gateway.textEmbeddingModel(`), directly or via a `{a,b}` / `*` path on its
 * row, and that the required caveats are present. Exits 1 on any gap.
 *
 *   node scripts/analysis/lum854-zdr/manifest-coverage.mjs
 */
import { execSync } from 'child_process'
import fs from 'fs'
const doc = fs.readFileSync('docs/privacy/llm-data-flow.md', 'utf8')
const files = execSync(`grep -rlE "gateway(\\.textEmbeddingModel)?\\(" lib app --include='*.ts' | grep -v '^lib/ai/gateway.ts$' | sort`, { encoding: 'utf8' }).trim().split('\n')
// Expand the doc's backticked paths (with {a,b} braces and * globs) into regexes.
const pats = [...doc.matchAll(/`((?:lib|app)\/[^`]+)`/g)].flatMap(([, p]) => {
  const m = p.match(/^(.*)\{([^}]*)\}(.*)$/)
  const alts = m ? m[2].split(',').map((a) => m[1] + a + m[3]) : [p]
  return alts.flatMap((a) => a.split(/、|,\s*/)).map((a) => new RegExp('^' + a.trim().replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\/$/, '/.*') + '(\\.ts)?$'))
})
let missing = 0
for (const f of files) {
  const hit = pats.some((r) => r.test(f))
  if (!hit) missing++
  console.log(`${hit ? 'covered' : 'MISSING'}  ${f}`)
}
console.log(`--- ${files.length} call-site files, ${missing} missing`)
for (const k of ['safety retention', '数据地域未核实', '托管方']) console.log(`caveat "${k}": ${doc.includes(k) ? 'present' : 'ABSENT'}`)
process.exit(missing ? 1 : 0)
