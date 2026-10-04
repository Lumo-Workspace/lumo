/**
 * @jest-environment node
 *
 * LUM-879 — the App webhook's `repository` event against a REAL Postgres
 * (every migration replayed into PGlite): `renamed` moves the confirmed list
 * and every stored `owner/name` to the new name in one transaction;
 * `deleted` / `transferred` remove the repository like an
 * `installation_repositories` removal, which now also strips the code from
 * the PR comments mirrored from it and retires its sync jobs' raw payloads.
 * A scan or mirror write that lands after the cleanup is scrubbed by its own
 * post-write check. Case-insensitive matches and workspaces sharing one
 * installation are exercised throughout.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
// Nothing here talks to GitHub: the transfer's recheck of the new name finds
// no workspace that confirmed it, and the SARIF ingest's scan dispatch is a
// POST to our own worker.
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
  createInstallationToken: jest.fn(),
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { notifyMentionsForMirror: jest.fn() },
}))

import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import {
  githubAppInstallService,
  scrubWorkspaceCode,
} from '@/lib/services/github-app-install.service'
import { scrubScanIfRepositoryUnconfirmed } from '@/lib/services/scan-code-retention.service'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { requireConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'
import { CODE_REMOVED_MARK } from '@/lib/integrations/github/mirror-code-strip'

jest.setTimeout(180_000)

const CODE = 'db.exec(`select * from users where id = ${req.query.id}`)'
const MARKER = 'req.query.id'
const OAUTH_COLUMN_FILLER = ['unused', 'by', 'this', 'suite'].join('-')
let seq = 0

const db = () => harness.prisma!

async function seedWorkspace(
  ws: string,
  installationId: number,
  repositories: string[]
) {
  await db().workspace.create({ data: { id: ws, name: ws, slug: ws } })
  await db().workspaceMember.create({
    data: {
      id: `${ws}_member`,
      workspaceId: ws,
      clerkId: `clerk_${ws}`,
      role: 'OWNER',
    },
  })
  await db().actor.create({
    data: {
      id: `${ws}_actor`,
      workspaceId: ws,
      type: 'HUMAN',
      memberId: `${ws}_member`,
    },
  })
  await db().team.create({
    data: {
      id: `${ws}_team`,
      workspaceId: ws,
      name: 'Eng',
      identifier: ws.toUpperCase().slice(-3),
    },
  })
  await db().project.create({
    data: {
      id: `${ws}_project`,
      workspaceId: ws,
      teamId: `${ws}_team`,
      createdByMemberId: `${ws}_member`,
      name: 'Project',
    },
  })
  await db().task.create({
    data: {
      id: `${ws}_task`,
      number: 1,
      title: 'Task',
      projectId: `${ws}_project`,
      teamId: `${ws}_team`,
    },
  })
  await db().gitHubAppInstallation.create({
    data: { workspaceId: ws, installationId, repositories },
  })
}

/** A PR with a scan and a finding that hold code. */
async function seedPr(id: string, ws: string, repo: string, number: number) {
  await db().pullRequest.create({
    data: {
      id,
      workspaceId: ws,
      taskId: `${ws}_task`,
      repo,
      number,
      title: `PR ${number}`,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'open',
      authorLogin: 'octo',
      headBranch: 'feature',
      baseBranch: 'main',
    },
  })
  await db().prSecurityScan.create({
    data: {
      id: `${id}_scan`,
      pullRequestId: id,
      workspaceId: ws,
      headSha: 'abc',
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      prSummary: { description: CODE },
    },
  })
  await db().prSecurityFinding.create({
    data: {
      scanId: `${id}_scan`,
      kind: 'VULNERABILITY',
      ruleId: 'vuln:sql-injection',
      severity: 'HIGH',
      provenance: 'LLM_JUDGE',
      filePath: 'src/db.ts',
      title: 'SQL injection',
      detail: CODE,
      evidence: CODE,
      fingerprint: `${id}_fp`,
    },
  })
}

async function scanHoldsCode(prId: string) {
  const scan = await db().prSecurityScan.findUniqueOrThrow({
    where: { id: `${prId}_scan` },
    select: { prSummary: true, findings: { select: { detail: true } } },
  })
  return JSON.stringify(scan).includes(MARKER)
}

/** A review comment mirrored from GitHub, as the inbound path stores it. */
async function seedMirroredComment(id: string, ws: string, prId: string) {
  const createdAt = new Date('2026-09-01T10:00:00Z')
  await db().comment.create({
    data: {
      id,
      taskId: `${ws}_task`,
      authorActorId: `${ws}_actor`,
      body: `<p>Parameterise this:<br />\`\`\`suggestion<br />${CODE}<br />\`\`\`<br />or it is injectable.</p>`,
      createdAt,
      updatedAt: createdAt,
    },
  })
  await db().prCommentMirror.create({
    data: {
      commentId: id,
      pullRequestId: prId,
      externalSource: 'REVIEW_LINE',
      externalId: String(++seq),
      externalUrl: `https://github.com/acme/x/pull/1#discussion_r${seq}`,
      externalUpdatedAt: createdAt,
      lastSyncedAt: createdAt,
      outboundActor: 'BOT_APP',
      filePath: 'src/db.ts',
      lineStart: 12,
      lineEnd: 12,
    },
  })
}

/** The jobs a PR's mirror can hold: an inbound retry, a dead letter, an outbound edit. */
async function seedJobs(
  prefix: string,
  ws: string,
  prId: string,
  commentId: string
) {
  const raw = {
    action: 'created',
    comment: {
      id: 1,
      body: `\`\`\`suggestion\n${CODE}\n\`\`\``,
      diff_hunk: CODE,
    },
    pull_request: { number: 1 },
    repository: { full_name: 'acme/x' },
  }
  await db().prCommentSyncJob.create({
    data: {
      id: `${prefix}_inbound`,
      direction: 'INBOUND',
      workspaceId: ws,
      payload: {
        reason: 'parent-mirror-missing',
        commentId,
        pullRequestId: prId,
        raw,
      },
    },
  })
  await db().prCommentSyncJob.create({
    data: {
      id: `${prefix}_dead`,
      direction: 'INBOUND',
      workspaceId: ws,
      status: 'DEAD_LETTER',
      deadLetteredAt: new Date('2026-09-02T00:00:00Z'),
      payload: {
        reason: 'parent-mirror-missing',
        commentId,
        pullRequestId: prId,
        raw,
      },
    },
  })
  await db().prCommentSyncJob.create({
    data: {
      id: `${prefix}_outbound`,
      direction: 'OUTBOUND',
      workspaceId: ws,
      commentId,
      payload: { op: 'UPDATE', mirrorId: 'm' },
    },
  })
}

async function confirmed(ws: string) {
  return (
    await db().gitHubAppInstallation.findUniqueOrThrow({
      where: { workspaceId: ws },
      select: { repositories: true },
    })
  ).repositories
}

async function prRepo(id: string) {
  return (await db().pullRequest.findUniqueOrThrow({ where: { id } })).repo
}

beforeAll(async () => {
  await harness.start()
  // ws_a and ws_b share installation 7 (LUM-872) and both confirm the web
  // repository, each in its own spelling; ws_c is on the same installation
  // but never confirmed it; ws_d is another installation altogether.
  await seedWorkspace('ws_a', 7, [
    'Acme/Web',
    'Acme/API',
    'acme/lib',
    'acme/keep',
    'acme/race',
  ])
  await seedWorkspace('ws_b', 7, ['acme/web', 'acme/lib'])
  await seedWorkspace('ws_c', 7, ['acme/keep'])
  await seedWorkspace('ws_d', 8, ['other/thing'])

  await seedPr('a_web', 'ws_a', 'acme/web', 1)
  await seedPr('b_web', 'ws_b', 'acme/web', 1)
  // ws_b already holds #2 under the new name: the old #2 cannot move.
  await seedPr('b_web2_old', 'ws_b', 'acme/web', 2)
  await seedPr('b_web2_new', 'ws_b', 'Acme/Web-App', 2)
  await seedPr('c_web', 'ws_c', 'acme/web', 1)

  await seedPr('a_api', 'ws_a', 'acme/api', 3)
  await seedPr('a_keep', 'ws_a', 'acme/keep', 4)
  await seedPr('a_race', 'ws_a', 'acme/race', 7)
  await seedPr('a_lib', 'ws_a', 'acme/lib', 5)
  await seedPr('b_lib', 'ws_b', 'Acme/Lib', 5)
  await seedPr('d_thing', 'ws_d', 'other/thing', 6)

  await seedMirroredComment('a_api_comment', 'ws_a', 'a_api')
  await seedJobs('a_api', 'ws_a', 'a_api', 'a_api_comment')
  await seedMirroredComment('a_keep_comment', 'ws_a', 'a_keep')
  await seedJobs('a_keep', 'ws_a', 'a_keep', 'a_keep_comment')
  await seedMirroredComment('b_lib_comment', 'ws_b', 'b_lib')
  await seedMirroredComment('d_thing_comment', 'ws_d', 'd_thing')

  // Everything else in ws_a that stores the web repository's name.
  await db().projectRepository.create({
    data: { projectId: 'ws_a_project', fullName: 'Acme/Web', name: 'Web' },
  })
  await db().taskBranch.create({
    data: { taskId: 'ws_a_task', repo: 'acme/web', branchName: 'lumo/x' },
  })
  await db().gitHubIntegration.create({
    data: {
      id: 'ws_a_oauth',
      workspaceId: 'ws_a',
      memberId: 'ws_a_member',
      // Never read here; any non-empty value satisfies the column.
      accessToken: OAUTH_COLUMN_FILLER,
      githubUserId: '1',
      githubLogin: 'octo',
      repositories: ['Acme/Web', 'acme/keep'],
    },
  })
  await db().gitHubWebhook.create({
    data: { integrationId: 'ws_a_oauth', repo: 'Acme/Web', githubHookId: 1 },
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-879 repository renamed', () => {
  const renamed = {
    action: 'renamed',
    installation: { id: 7 },
    repository: { full_name: 'Acme/Web-App', name: 'Web-App' },
    changes: { repository: { name: { from: 'web' } } },
  }

  it('repository renamed moves the confirmed list and stored names of every confirming workspace', async () => {
    await githubAccessRecheckService.applyRepositoryEvent(renamed)

    // Both sharing workspaces follow, whatever spelling they stored.
    expect(await confirmed('ws_a')).toEqual([
      'Acme/Web-App',
      'Acme/API',
      'acme/lib',
      'acme/keep',
      'acme/race',
    ])
    expect(await confirmed('ws_b')).toEqual(['Acme/Web-App', 'acme/lib'])
    expect(await prRepo('a_web')).toBe('Acme/Web-App')
    expect(await prRepo('b_web')).toBe('Acme/Web-App')
    // A collision under the new name is left alone, not merged or dropped.
    expect(await prRepo('b_web2_old')).toBe('acme/web')
    expect(await prRepo('b_web2_new')).toBe('Acme/Web-App')
    // A workspace that never confirmed it is not touched.
    expect(await confirmed('ws_c')).toEqual(['acme/keep'])
    expect(await prRepo('c_web')).toBe('acme/web')

    const projectRepo = await db().projectRepository.findFirstOrThrow({
      where: { projectId: 'ws_a_project' },
    })
    expect([projectRepo.fullName, projectRepo.name]).toEqual([
      'Acme/Web-App',
      'Web-App',
    ])
    expect(
      (
        await db().taskBranch.findFirstOrThrow({
          where: { taskId: 'ws_a_task' },
        })
      ).repo
    ).toBe('Acme/Web-App')
    expect(
      (
        await db().gitHubWebhook.findFirstOrThrow({
          where: { integrationId: 'ws_a_oauth' },
        })
      ).repo
    ).toBe('Acme/Web-App')
    expect(
      (
        await db().gitHubIntegration.findUniqueOrThrow({
          where: { id: 'ws_a_oauth' },
        })
      ).repositories
    ).toEqual(['Acme/Web-App', 'acme/keep'])

    // A rename is not a removal: the scan code stays.
    expect(await scanHoldsCode('a_web')).toBe(true)
    expect(await scanHoldsCode('b_web')).toBe(true)
  })

  it('repository renamed keeps later scans, events and SARIF working under the new name', async () => {
    // A scan's post-write check sees its PR and the list under the same name.
    expect(await scrubScanIfRepositoryUnconfirmed('a_web_scan')).toBe(false)
    expect(await scanHoldsCode('a_web')).toBe(true)
    // Token mint and App event routing accept the new name (any case)…
    await expect(
      requireConfirmedRepository('ws_a', 'acme/web-app')
    ).resolves.toEqual({ installationId: 7, repository: 'Acme/Web-App' })
    expect(
      await githubAppInstallService.resolveWorkspacesForRepository(
        7,
        'acme/WEB-APP'
      )
    ).toEqual(['ws_a', 'ws_b'])
    // …and no longer the old one.
    expect(
      await githubAppInstallService.isRepositoryConfirmed('ws_a', 'Acme/Web')
    ).toBe(false)
    // A SARIF report CI pushes under the new name finds both workspaces' PR.
    const outcome = await securitySarifIngestService.resolveScan({
      url: 'https://blob.test/r.sarif.gz',
      pathname: 'r.sarif.gz',
      repository: 'Acme/Web-App',
      headSha: 'def',
      prNumber: 1,
      tool: 'semgrep',
    })
    expect(outcome.kind).toBe('ok')
    const workspaces = [
      ...(outcome.kind === 'ok'
        ? [outcome.pr, ...(outcome.others ?? []).map(o => o.pr)]
        : []),
    ].map(pr => pr.workspaceId)
    expect(workspaces.sort()).toEqual(['ws_a', 'ws_b'])
  })

  it('repository renamed is idempotent on redelivery', async () => {
    await githubAccessRecheckService.applyRepositoryEvent(renamed)
    expect(await confirmed('ws_b')).toEqual(['Acme/Web-App', 'acme/lib'])
    expect(await prRepo('b_web2_old')).toBe('acme/web')
  })
})

/** The race tests' own removal, so each runs on its own (idempotent). */
async function removeRaceRepository() {
  await githubAccessRecheckService.applyRepositoryEvent({
    action: 'deleted',
    installation: { id: 7 },
    repository: { full_name: 'acme/race', name: 'race' },
  })
  expect(await confirmed('ws_a')).not.toContain('acme/race')
}

describe('LUM-879 repository deleted', () => {
  it('repository deleted scrubs scan code, strips mirrored comments and retires sync payloads', async () => {
    const before = await db().comment.findUniqueOrThrow({
      where: { id: 'a_api_comment' },
    })

    await githubAccessRecheckService.applyRepositoryEvent({
      action: 'deleted',
      installation: { id: 7 },
      repository: { full_name: 'acme/api', name: 'api' },
    })

    // Case-insensitive: `Acme/API` leaves the list; the rest stays.
    const list = await confirmed('ws_a')
    expect(list).not.toContain('Acme/API')
    expect(list).toEqual(expect.arrayContaining(['acme/keep', 'acme/race']))
    expect(await scanHoldsCode('a_api')).toBe(false)

    // The discussion stays, the code goes; author and timestamps unchanged.
    const after = await db().comment.findUniqueOrThrow({
      where: { id: 'a_api_comment' },
    })
    expect(after.body).not.toContain(MARKER)
    expect(after.body).toContain('Parameterise this:')
    expect(after.body).toContain('or it is injectable.')
    expect(after.body).toContain(`${CODE_REMOVED_MARK} suggestion`)
    expect(after.authorActorId).toBe(before.authorActorId)
    expect(after.createdAt).toEqual(before.createdAt)
    // Not a local edit: the mirror must not push the stripped body to GitHub.
    expect(after.updatedAt).toEqual(before.updatedAt)
    expect(
      await db().prCommentMirror.count({
        where: { commentId: 'a_api_comment' },
      })
    ).toBe(1)

    // Every job of the repository is retired with its raw payload dropped.
    for (const id of ['a_api_inbound', 'a_api_dead', 'a_api_outbound']) {
      const job = await db().prCommentSyncJob.findUniqueOrThrow({
        where: { id },
      })
      expect(job.status).toBe('DEAD_LETTER')
      expect(job.payloadPurgedAt).not.toBeNull()
      expect(JSON.stringify(job.payload)).not.toContain(MARKER)
    }
    // A dead letter keeps its own clock.
    expect(
      (
        await db().prCommentSyncJob.findUniqueOrThrow({
          where: { id: 'a_api_dead' },
        })
      ).deadLetteredAt
    ).toEqual(new Date('2026-09-02T00:00:00Z'))

    // Another repository of the same workspace is untouched.
    expect(await scanHoldsCode('a_keep')).toBe(true)
    expect(
      (
        await db().comment.findUniqueOrThrow({
          where: { id: 'a_keep_comment' },
        })
      ).body
    ).toContain(MARKER)
    const keptJob = await db().prCommentSyncJob.findUniqueOrThrow({
      where: { id: 'a_keep_inbound' },
    })
    expect([keptJob.status, keptJob.payloadPurgedAt]).toEqual(['PENDING', null])
  })

  it('a scan write that lands after the removal is scrubbed by its post-write check', async () => {
    await removeRaceRepository()
    // The in-flight scan's writer: findings first, then the LUM-896 recheck.
    await prSecurityScanRepository.createFindings([
      {
        scanId: 'a_race_scan',
        kind: 'VULNERABILITY',
        ruleId: 'vuln:sql-injection',
        severity: 'HIGH',
        provenance: 'LLM_JUDGE',
        filePath: 'src/late.ts',
        line: 1,
        title: 'late',
        detail: CODE,
        evidence: CODE,
        fingerprint: 'late_fp',
      },
    ])
    expect(await scanHoldsCode('a_race')).toBe(true)
    expect(await scrubScanIfRepositoryUnconfirmed('a_race_scan')).toBe(true)
    expect(await scanHoldsCode('a_race')).toBe(false)
    // Control: the same write on a confirmed repository is kept.
    expect(await scrubScanIfRepositoryUnconfirmed('a_keep_scan')).toBe(false)
  })

  it('a mirrored comment that lands after the removal has its code stripped', async () => {
    await removeRaceRepository()
    const reviewComment = (id: number, prId: string) => ({
      event: 'pull_request_review_comment' as const,
      action: 'created' as const,
      workspaceId: 'ws_a',
      taskId: 'ws_a_task',
      pullRequestId: prId,
      raw: {
        comment: {
          id,
          node_id: `n${id}`,
          html_url: `https://github.com/acme/x/pull/1#discussion_r${id}`,
          body: `Late review\n\`\`\`suggestion\n${CODE}\n\`\`\``,
          updated_at: '2026-09-03T00:00:00Z',
          user: { id: 9, login: 'reviewer', type: 'User', avatar_url: '' },
          path: 'src/db.ts',
          line: 3,
        },
      },
    })
    await prCommentMirrorService.runInbound(reviewComment(9001, 'a_race'))
    await prCommentMirrorService.runInbound(reviewComment(9002, 'a_keep'))

    const late = await db().prCommentMirror.findUniqueOrThrow({
      where: {
        externalSource_externalId: {
          externalSource: 'REVIEW_LINE',
          externalId: '9001',
        },
      },
      select: { comment: { select: { body: true } } },
    })
    expect(late.comment.body).toContain('Late review')
    expect(late.comment.body).not.toContain(MARKER)
    // Control: a confirmed repository's comment keeps its suggestion.
    const kept = await db().prCommentMirror.findUniqueOrThrow({
      where: {
        externalSource_externalId: {
          externalSource: 'REVIEW_LINE',
          externalId: '9002',
        },
      },
      select: { comment: { select: { body: true } } },
    })
    expect(kept.comment.body).toContain(MARKER)
  })
})

describe('LUM-879 repository transferred', () => {
  it('repository transferred removes the old name from every workspace that confirmed it', async () => {
    // The event can arrive on the new owner's installation (99), which no
    // workspace here is bound to; the old name is found wherever confirmed.
    await githubAccessRecheckService.applyRepositoryEvent({
      action: 'transferred',
      installation: { id: 99 },
      repository: { full_name: 'neworg/lib', name: 'lib' },
      changes: { owner: { from: { organization: { login: 'acme' } } } },
    })

    expect(await confirmed('ws_a')).not.toContain('acme/lib')
    expect(await confirmed('ws_a')).toContain('acme/keep')
    expect(await confirmed('ws_b')).toHaveLength(1)
    expect(await confirmed('ws_b')).not.toContain('acme/lib')
    expect(await scanHoldsCode('a_lib')).toBe(false)
    expect(await scanHoldsCode('b_lib')).toBe(false)
    expect(
      (await db().comment.findUniqueOrThrow({ where: { id: 'b_lib_comment' } }))
        .body
    ).not.toContain(MARKER)
    // Another installation's workspace is untouched.
    expect(await confirmed('ws_d')).toEqual(['other/thing'])
    expect(await scanHoldsCode('d_thing')).toBe(true)
  })
})

describe('LUM-879 uninstall', () => {
  it('uninstall scrub strips every mirrored comment of the workspace', async () => {
    await scrubWorkspaceCode('ws_d', 'uninstalled from Lumo')
    const body = (
      await db().comment.findUniqueOrThrow({ where: { id: 'd_thing_comment' } })
    ).body
    expect(body).not.toContain(MARKER)
    expect(body).toContain('or it is injectable.')
  })
})
