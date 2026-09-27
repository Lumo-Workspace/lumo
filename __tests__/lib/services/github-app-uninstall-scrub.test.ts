/**
 * @jest-environment node
 *
 * LUM-855: uninstalling the GitHub App disposes of the customer code Lumo holds
 * for that workspace — against a REAL Postgres, because "that workspace only"
 * is a WHERE clause over a relation filter that a mocked Prisma cannot check.
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

async function seed(p: string, installationId: number) {
  const ws = `${p}ws`
  await harness.insert('workspaces', { id: ws, name: p, slug: `${p}slug` })
  await harness.insert('github_app_installations', {
    id: `${p}inst`,
    workspaceId: ws,
    installationId,
  })
  await harness.insert('pull_requests', {
    id: `${p}pr`,
    workspaceId: ws,
    repo: `acme/${p}repo`,
    number: 1,
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
    title: 'SQL injection',
    detail: 'Query built from request input',
    evidence: CODE,
    callChain: JSON.stringify([{ file: 'src/db.ts', code: CODE }]),
  })
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
      title: 'SQL injection',
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
      `select id from pr_security_findings where evidence like '%db.exec%' or "callChain"::text like '%db.exec%'
       union all
       select id from pr_security_scans where "huntAudit"::text like '%db.exec%' or "prSummary"::text like '%db.exec%'`
    )
    expect(leftovers.map(r => r.id).sort()).toEqual(['w3_finding', 'w3_scan'])
  })
})
