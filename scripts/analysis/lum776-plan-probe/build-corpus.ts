/**
 * LUM-776 — rebuild the planner's REAL prompts from production scans, so the
 * A/B probe (`probe.ts`) measures the call on the inputs it actually sees.
 *
 * LUM-766 learned this the hard way: the same prompt repeated 19 times is one
 * sample, not nineteen, and a slim synthetic prompt reported ~50% success where
 * real ones scored 0/16. Every prompt here is a distinct (PR, head sha) pair
 * whose scan really ran the planner (`plannedBy` ∈ {model, fallback}).
 *
 * READ-ONLY against production: it reads `PrSecurityScan` + findings + the
 * task context the planner would load, and fetches each PR's diff from GitHub
 * with `gh` (the same unified diff stage A parses). It writes ONE local JSON
 * file — the prompts contain acceptance criteria and team memory, so the
 * corpus is not committed; only `probe.ts`'s results are.
 *
 * Run (from any checkout, env is the MAIN checkout's .env.production):
 *   DOTENV_CONFIG_PATH=/abs/path/to/.env.production npx tsx -r dotenv/config \
 *     scripts/analysis/lum776-plan-probe/build-corpus.ts --out /abs/corpus.json [--take 24]
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { prisma } from '../../../lib/db/prisma'
import { prSecurityScanRepository } from '../../../lib/repositories/pr-security-scan.repository'
import { addedLinesWithNumbers } from '../../../lib/security-scan/diff-lines'
import { evaluateHuntTrigger } from '../../../lib/security-scan/hunt/trigger'
import { isGraphSourcePath } from '../../../lib/security-scan/graph/imports'
import { renderHuntTaskContext } from '../../../lib/security-scan/hunt/task-context'
import { loadHuntTaskContext } from '../../../lib/services/security-hunt-task-context'
import type { PlanClientInput } from '../../../lib/llm/security-hunt-plan-client'

export interface CorpusEntry {
  id: string
  scanId: string
  pr: number
  headSha: string
  plannedByInProd: string
  input: Omit<PlanClientInput, 'timeoutMs'>
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function fetchDiff(repo: string, sha: string): string {
  return execFileSync(
    'gh',
    [
      'api',
      '-H',
      'Accept: application/vnd.github.v3.diff',
      `repos/${repo}/compare/main...${sha}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
}

async function main(): Promise<void> {
  const out = arg('--out')
  if (!out) throw new Error('--out <file> is required')
  const take = Number(arg('--take', '24'))
  const scans = await prisma.prSecurityScan.findMany({
    where: { huntAudit: { path: ['plannedBy'], not: 'null' } },
    orderBy: { startedAt: 'desc' },
    take: 120,
    select: {
      id: true,
      headSha: true,
      taskId: true,
      huntAudit: true,
      pullRequest: { select: { number: true, repo: true } },
      findings: {
        select: { severity: true },
        where: { severity: 'HIGH' },
        take: 1,
      },
    },
  })
  const seen = new Set<string>()
  const corpus: CorpusEntry[] = []
  for (const s of scans) {
    if (corpus.length >= take) break
    const audit = s.huntAudit as { plannedBy?: string }
    if (audit.plannedBy !== 'model' && audit.plannedBy !== 'fallback') continue
    if (!s.pullRequest) continue
    const key = `${s.pullRequest.number}@${s.headSha}`
    if (seen.has(key)) continue
    seen.add(key)
    let diff: string
    try {
      diff = fetchDiff(s.pullRequest.repo, s.headSha)
    } catch (error) {
      console.error(
        `skip ${key}: diff fetch failed (${(error as Error).message.split('\n')[0]})`
      )
      continue
    }
    const files = addedLinesWithNumbers(diff)
    const trigger = evaluateHuntTrigger({
      files,
      hasHighFinding: s.findings.length > 0,
      hasOpenL4Crossing: false,
    })
    if (!trigger.hunt) {
      console.error(`skip ${key}: trigger says no hunt on the rebuilt diff`)
      continue
    }
    const findings = await prSecurityScanRepository.findFindingSummaryByScan(
      s.id
    )
    const taskContext = renderHuntTaskContext(
      await loadHuntTaskContext(s.taskId)
    )
    corpus.push({
      id: `p${String(corpus.length + 1).padStart(2, '0')}`,
      scanId: s.id,
      pr: s.pullRequest.number,
      headSha: s.headSha,
      plannedByInProd: audit.plannedBy,
      input: {
        reasons: trigger.reasons,
        touchedPaths: files.map(f => f.path).filter(isGraphSourcePath),
        findings,
        ...(taskContext ? { taskContext } : {}),
      },
    })
    console.error(
      `ok ${key}: reasons=${trigger.reasons.length} paths=${files.length} findings=${findings.length} ctx=${taskContext.length}`
    )
  }
  writeFileSync(out, JSON.stringify(corpus, null, 2))
  console.log(`wrote ${corpus.length} prompts → ${out}`)
}

main()
  .catch(err => {
    console.error('[lum776] fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
