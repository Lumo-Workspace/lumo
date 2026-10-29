/**
 * LUM-1286 eval — embed every issue title (and each canonical) of a data dir
 * with the production embedding model, for the offline recall experiment.
 *
 *   npx tsx --env-file=<.env.local> scripts/analysis/lum1286-dup-eval/embed.ts <data_dir>
 *
 * Writes <data_dir>/emb.f32 (row-major float32, EMBEDDING_DIM per row) and
 * <data_dir>/emb_ids.json (issue number per row). Resumable: rows already in
 * the files are kept.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { EMBEDDING_DIM, embedTexts } from '@/lib/ai/embedding'

const dir = process.argv[2]
if (!dir) throw new Error('usage: embed.ts <data_dir>')

interface Issue {
  number: number
  title: string
}
const issues: Issue[] = JSON.parse(readFileSync(`${dir}/issues.json`, 'utf8'))
const dups: { canonical: Issue }[] = JSON.parse(
  readFileSync(`${dir}/dups.json`, 'utf8')
)
const byNumber = new Map<number, string>()
for (const x of issues) byNumber.set(x.number, x.title)
for (const d of dups) byNumber.set(d.canonical.number, d.canonical.title)

const idsPath = `${dir}/emb_ids.json`
const vecPath = `${dir}/emb.f32`
const done: number[] = existsSync(idsPath)
  ? JSON.parse(readFileSync(idsPath, 'utf8'))
  : []
if (!existsSync(vecPath)) writeFileSync(vecPath, Buffer.alloc(0))
const seen = new Set(done)
const todo = [...byNumber.entries()].filter(([n]) => !seen.has(n))

const BATCH = 96
async function main() {
  process.stderr.write(
    `${dir}: ${byNumber.size} titles, ${todo.length} to embed\n`
  )
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    let vecs: number[][] | null = null
    for (let attempt = 0; attempt < 5 && !vecs; attempt++) {
      try {
        vecs = await embedTexts(chunk.map(([, t]) => t))
      } catch (e) {
        process.stderr.write(
          `  retry ${attempt + 1}: ${(e as Error).message.slice(0, 120)}\n`
        )
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
    if (!vecs) throw new Error('embedding failed after retries')
    const buf = Buffer.alloc(vecs.length * EMBEDDING_DIM * 4)
    vecs.forEach((v, r) =>
      v.forEach((x, c) => buf.writeFloatLE(x, (r * EMBEDDING_DIM + c) * 4))
    )
    appendFileSync(vecPath, buf)
    done.push(...chunk.map(([n]) => n))
    writeFileSync(idsPath, JSON.stringify(done))
  }
}
main().then(
  () => process.exit(0),
  e => {
    process.stderr.write(String(e) + '\n')
    process.exit(1)
  }
)
