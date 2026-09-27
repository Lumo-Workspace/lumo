/**
 * @jest-environment node
 *
 * LUM-855: uninstalling the GitHub App disposes of the customer code Lumo holds
 * for that workspace — against a REAL Postgres, because "that workspace only"
 * is a WHERE clause over a relation filter that a mocked Prisma cannot check.
 *
 * LUM-872: one GitHub installation can back several workspaces (installationId
 * is not unique), and a repository dropped from the installation's scope is
 * scrubbed like an uninstall.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  deleteAppInstallation: jest.fn(),
}))

import { githubAppInstallService } from '@/lib/services/github-app-install.service'

jest.setTimeout(180_000)

const CODE = 'const token = req.query.t; db.exec(`select ${token}`)'

// pull_requests is unique on (repo, number) — each seeded PR takes a new number.
let prNumber = 0

/** One PR in `repo` with a scan + finding holding code; ids use prefix `p`. */
async function seedScan(p: string, ws: string, repo: string) {
  await harness.insert('pull_requests', {
    id: `${p}pr`,
    workspaceId: ws,
    repo,
    number: ++prNumber,
  })
  await harness.insert('pr_security_scans', {
    id: `${p}scan`,
    pullRequestId: `${p}pr`,
    workspaceId: ws,
    headSha: 'abc',
    huntAudit: JSON.stringify({ shell: [{ out: CODE }] }),
    huntJob: JSON.stringify({ touchedPaths: ['src/db.ts'] }),
    prSummary: JSON.stringify({ description: CODE }),
  })
  await harness.insert('pr_security_findings', {
    id: `${p}finding`,
    scanId: `${p}scan`,
    ruleId: 'vuln:sql-injection',
    title: 'SQL injection',
    detail: 'Query built from request input',
    evidence: CODE,
    callChain: JSON.stringify([{ file: 'src/db.ts', code: CODE }]),
  })
}

async function seedWorkspace(p: string, installationId: number) {
  const ws = `${p}ws`
  await harness.insert('workspaces', { id: ws, name: p, slug: `${p}slug` })
  await harness.insert('github_app_installations', {
    id: `${p}inst`,
    workspaceId: ws,
    installationId,
    repositories: ['acme/gone', 'acme/kept'],
  })
  return ws
}

async function seed(p: string, installationId: number) {
  const ws = await seedWorkspace(p, installationId)
  await seedScan(p, ws, `acme/${p}repo`)
}

async function codeState(p: string) {
  const [scan] = await harness.query<{
    huntAudit: unknown
    huntJob: unknown
    prSummary: unknown
  }>(
    `select "huntAudit", "huntJob", "prSummary" from pr_security_scans where id = $1`,
    [`${p}scan`]
  )
  const [finding] = await harness.query<{
    evidence: string
    callChain: unknown
    title: string
  }>(
    `select evidence, "callChain", title from pr_security_findings where id = $1`,
    [`${p}finding`]
  )
  if (!scan || !finding) throw new Error(`no seeded scan/finding for ${p}`)
  return { scan, finding }
}

beforeAll(async () => {
  await harness.start()
  await seed('w1_', 101)
  await seed('w2_', 202)
  await seed('w3_', 303)
  // LUM-872: s1/s2 share installation 404; u is an unrelated installation.
  await seed('s1_', 404)
  await seed('s2_', 404)
  await seed('u_', 505)
  // r1/r2 share installation 606, each with a PR in a repo that stays and
  // one in a repo about to be removed from the installation.
  for (const p of ['r1_', 'r2_']) {
    const ws = await seedWorkspace(p, 606)
    await seedScan(`${p}gone_`, ws, 'acme/gone')
    await seedScan(`${p}kept_`, ws, 'acme/kept')
  }
  // t: a finding whose LLM-written text quotes the code.
  await seed('t_', 707)
  await harness.query(
    `update pr_security_findings
        set title = $1, detail = $1, "suggestedReason" = $1,
            "suggestedDisposition" = 'FALSE_POSITIVE', disposition = 'ACCEPTED_RISK',
            "dispositionNote" = 'owner accepted'
      where id = 't_finding'`,
    [`Injection via ${CODE}`]
  )
})

afterAll(async () => {
  await harness.stop()
})

describe('GitHub App uninstall scrub', () => {
  it('uninstall scrubs code-bearing scan data for that workspace only', async () => {
    // A suspend is reversible — it clears nothing.
    await githubAppInstallService.applyInstallationEvent({
      action: 'suspend',
      installation: { id: 303 },
    })
    const suspended = await codeState('w3_')
    expect(suspended.finding.evidence).toBe(CODE)
    expect(suspended.scan.huntAudit).not.toBeNull()

    // Uninstalled on GitHub → the `deleted` webhook scrubs w1.
    await githubAppInstallService.applyInstallationEvent({
      action: 'deleted',
      installation: { id: 101 },
    })
    const w1 = await codeState('w1_')
    expect(w1.finding).toEqual({
      evidence: '',
      callChain: null,
      title: 'vuln:sql-injection',
    })
    expect(w1.scan).toEqual({ huntAudit: null, huntJob: null, prSummary: null })

    // Rows survive — history and DONE gating still read them.
    const [rows] = await harness.query<{ scans: number; findings: number }>(
      `select (select count(*)::int from pr_security_scans where "workspaceId" = 'w1_ws') as scans,
              (select count(*)::int from pr_security_findings where "scanId" = 'w1_scan') as findings`
    )
    expect(rows).toEqual({ scans: 1, findings: 1 })

    // Another workspace's code is untouched.
    const w2Before = await codeState('w2_')
    expect(w2Before.finding.evidence).toBe(CODE)
    expect(w2Before.scan.prSummary).not.toBeNull()

    // Uninstalled from Lumo (owner disconnect) → scrubs w2 too.
    await expect(
      githubAppInstallService.uninstall('w2_ws', 'OWNER')
    ).resolves.toEqual({ removed: true })
    const w2 = await codeState('w2_')
    expect(w2.finding.evidence).toBe('')
    expect(w2.scan.huntAudit).toBeNull()

    // No stored text anywhere still holds the code, except the suspended w3.
    const leftovers = await harness.query<{ id: string }>(
      `select id from pr_security_findings where id like 'w%' and (evidence like '%db.exec%' or "callChain"::text like '%db.exec%')
       union all
       select id from pr_security_scans where id like 'w%' and ("huntAudit"::text like '%db.exec%' or "prSummary"::text like '%db.exec%')`
    )
    expect(leftovers.map(r => r.id).sort()).toEqual(['w3_finding', 'w3_scan'])
  })

  it('installation deleted scrubs every workspace sharing the installation', async () => {
    await githubAppInstallService.applyInstallationEvent({
      action: 'deleted',
      installation: { id: 404 },
    })

    for (const p of ['s1_', 's2_']) {
      const { scan, finding } = await codeState(p)
      expect(finding.evidence).toBe('')
      expect(finding.callChain).toBeNull()
      expect(scan).toEqual({ huntAudit: null, huntJob: null, prSummary: null })
    }
    const [installs] = await harness.query<{ n: number }>(
      `select count(*)::int as n from github_app_installations where "installationId" = 404`
    )
    expect(installs?.n).toBe(0)

    // The unrelated installation's workspace keeps its code.
    const u = await codeState('u_')
    expect(u.finding.evidence).toBe(CODE)
    expect(u.scan.prSummary).not.toBeNull()
  })

  it('repository removed from the installation scrubs that repository only', async () => {
    await githubAppInstallService.applyInstallationRepositoriesEvent({
      action: 'removed',
      installation: { id: 606 },
      repositories_removed: [{ full_name: 'acme/gone' }],
    })

    for (const p of ['r1_', 'r2_']) {
      const gone = await codeState(`${p}gone_`)
      expect(gone.finding.evidence).toBe('')
      expect(gone.scan).toEqual({
        huntAudit: null,
        huntJob: null,
        prSummary: null,
      })
      const kept = await codeState(`${p}kept_`)
      expect(kept.finding.evidence).toBe(CODE)
      expect(kept.scan.huntAudit).not.toBeNull()
    }
    const scopes = await harness.query<{ repositories: string[] }>(
      `select repositories from github_app_installations where "installationId" = 606 order by id`
    )
    expect(scopes.map(r => r.repositories)).toEqual([
      ['acme/kept'],
      ['acme/kept'],
    ])
  })

  it('scrub clears finding text that can quote code', async () => {
    await githubAppInstallService.applyInstallationEvent({
      action: 'deleted',
      installation: { id: 707 },
    })

    const [finding] = await harness.query<Record<string, unknown>>(
      `select title, detail, evidence, "suggestedReason", "suggestedDisposition",
              disposition, "dispositionNote"
         from pr_security_findings where id = 't_finding'`
    )
    expect(finding).toEqual({
      title: 'vuln:sql-injection',
      detail: '',
      evidence: '',
      suggestedReason: null,
      // Verdicts and the human's ruling are not code — they stay.
      suggestedDisposition: 'FALSE_POSITIVE',
      disposition: 'ACCEPTED_RISK',
      dispositionNote: 'owner accepted',
    })
  })
})
