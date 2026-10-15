/**
 * LUM-1158 — the benchmark report as markdown, from judge.ts's output.
 * Pure: `score.ts` reads the files and prints this.
 *
 * Head-to-head rows are computed on the PRs every compared tag judged, so a
 * failed or missing judgement never shifts one side's denominator.
 */
import {
  POOLED_HEADER,
  REFERENCE_LABEL,
  pooled,
  pooledRow,
  splitRecall,
  type JudgedPr,
} from './bench-lib'

export interface ReportInput {
  meta: Record<string, { id: string; source: string }>
  judged: Record<string, Record<string, JudgedPr>>
  lumoTags: readonly string[]
}

function common(
  urls: readonly string[],
  judged: ReportInput['judged'],
  tags: readonly string[]
): string[] {
  return urls.filter(u => tags.every(t => judged[t]?.[u]))
}

/** Per-category findings / matched / precision for one tag on `urls`. */
export function categoryBreakdown(
  rows: readonly JudgedPr[]
): Array<{ category: string; findings: number; matched: number }> {
  const by = new Map<string, { findings: number; matched: number }>()
  for (const r of rows) {
    const hit = new Set(r.matches.map(m => m.findingId))
    for (const f of r.findings) {
      const c = by.get(f.category) ?? { findings: 0, matched: 0 }
      c.findings++
      if (hit.has(f.id)) c.matched++
      by.set(f.category, c)
    }
  }
  return [...by.entries()]
    .map(([category, c]) => ({ category, ...c }))
    .sort((a, b) => b.findings - a.findings)
}

export function buildReport(input: ReportInput): string {
  const { meta, judged, lumoTags } = input
  const urls = Object.keys(meta).sort((a, b) =>
    meta[a]!.id.localeCompare(meta[b]!.id)
  )
  const oss = common(
    urls.filter(u => meta[u]!.source === 'oss'),
    judged,
    [REFERENCE_LABEL, ...lumoTags]
  )
  const own = common(
    urls.filter(u => meta[u]!.source === 'own'),
    judged,
    lumoTags
  )
  const out: string[] = []
  const row = (tag: string, set: readonly string[]) =>
    pooledRow(tag, pooled(set.map(u => judged[tag]![u]!.score)))

  out.push(
    `## Public PRs reviewed by ${REFERENCE_LABEL} (${oss.length})`,
    '',
    POOLED_HEADER
  )
  out.push(row(REFERENCE_LABEL, oss))
  for (const t of lumoTags) out.push(row(t, oss))

  out.push('', '### Recall by source of the fix', '')
  out.push(
    `| Lumo tag | fixes ${REFERENCE_LABEL} pointed at | other fixes |`,
    '| --- | --- | --- |'
  )
  for (const t of lumoTags) {
    const s = splitRecall(
      oss.map(u => ({
        lumo: judged[t]![u]!.score,
        reference: judged[REFERENCE_LABEL]![u]!.score,
      }))
    )
    const pr = (h: number, n: number) =>
      `${h}/${n} (${n ? ((100 * h) / n).toFixed(1) : '0.0'}%)`
    out.push(
      `| ${t} | ${pr(s.pointed.hit, s.pointed.total)} | ${pr(s.other.hit, s.other.total)} |`
    )
  }

  out.push('', '### Precision by finding category', '')
  out.push(
    '| Reviewer | category | findings | matched | precision |',
    '| --- | --- | --- | --- | --- |'
  )
  for (const t of [REFERENCE_LABEL, ...lumoTags]) {
    for (const c of categoryBreakdown(oss.map(u => judged[t]![u]!))) {
      const p = c.findings ? ((100 * c.matched) / c.findings).toFixed(1) : '0.0'
      out.push(
        `| ${t} | ${c.category} | ${c.findings} | ${c.matched} | ${p}% |`
      )
    }
  }

  if (own.length) {
    out.push(
      '',
      `## Lumo's own PRs (${own.length}, Lumo only)`,
      '',
      POOLED_HEADER
    )
    for (const t of lumoTags) out.push(row(t, own))
  }

  const tags = [REFERENCE_LABEL, ...lumoTags]
  out.push(
    '',
    '## Per PR (matched findings / findings · matched fixes / fixes)',
    ''
  )
  out.push(
    `| PR | ${tags.join(' | ')} |`,
    `| --- | ${tags.map(() => '---').join(' | ')} |`
  )
  for (const u of [...oss, ...own]) {
    const cells = tags.map(t => {
      const j = judged[t]?.[u]
      if (!j) return '—'
      const s = j.score
      return `${s.matchedFindings}/${s.findings} · ${s.matchedFixes}/${s.fixes}${j.skipped ? ' (skipped)' : ''}`
    })
    out.push(`| ${meta[u]!.id} | ${cells.join(' | ')} |`)
  }

  out.push(
    '',
    `## Fixes ${REFERENCE_LABEL} pointed at that no Lumo run found`,
    ''
  )
  let missed = 0
  for (const u of oss) {
    const ref = judged[REFERENCE_LABEL]![u]!
    const lumoHit = new Set(
      lumoTags.flatMap(t => judged[t]![u]!.score.matchedFixIds)
    )
    for (const id of ref.score.matchedFixIds) {
      if (lumoHit.has(id)) continue
      const by = ref.matches.filter(m => m.fixId === id).map(m => m.findingId)
      const f = ref.findings.find(x => x.id === by[0])
      out.push(
        `- ${meta[u]!.id} ${id} [${f?.category ?? '?'}] ${f?.text ?? ''}`
      )
      missed++
    }
  }
  if (!missed) out.push('- none')
  return `${out.join('\n')}\n`
}
