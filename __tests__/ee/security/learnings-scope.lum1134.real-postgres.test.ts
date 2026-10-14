/**
 * @jest-environment node
 *
 * LUM-1134 — the workspace learnings scope (CodeRabbit's
 * `knowledge_base.learnings.scope`) against a REAL Postgres replayed from
 * every migration (the LUM-1134 migration included):
 *
 * - the setting: OWNER changes it (audited), a MEMBER gets 403, the column
 *   refuses anything but local | global | auto;
 * - the review: `local` reads only the reviewed repository's learnings,
 *   `global` adds the workspace's other repositories' repository-wide ones,
 *   `auto` follows the repository's visibility (unknown ⇒ local), and another
 *   workspace's learnings never appear.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import {
  loadReviewLearnings,
  type RepoVisibilityReader,
} from '@/ee/security/services/review-learnings.service'
import { securityScanSettingsService } from '@/ee/security/services/security-scan-settings.service'
import { updateSecurityScanSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import { memberAuditContext } from '@/lib/api/audit-context'
import type { LearningsScope } from '@/ee/security/security-scan/learnings-scope'

jest.setTimeout(180_000)

const WS = 'ws_ls'
const WS2 = 'ws_ls_other'
const OWNER = 'm_ls_owner'
const MEMBER = 'm_ls_member'

const RULE = {
  own: 'Own repo: raw SQL in scripts is intentional.',
  wide: 'Sibling repo: feature flags read from env on purpose.',
  missedMerge: 'Sibling repo: request ids in logs are intentional.',
  pending: 'Sibling repo: the retry loop has no backoff on purpose.',
  docs: 'Sibling repo: docs examples use fake tokens.',
  tenant: 'Another tenant: never cross workspaces.',
}

async function seedLearning(o: {
  id: string
  ws: string
  project: string
  repo: string
  rule: string
  sourcePr: string | null
  repoWide: boolean
  pathGlob?: string | null
}) {
  await harness.insert('memories', {
    id: o.id,
    workspaceId: o.ws,
    projectId: o.project,
    scope: 'PROJECT',
    category: 'CONVENTION',
    content: JSON.stringify({
      summary: 'PR review learning',
      rule: o.rule,
      scope: o.repo,
    }),
    status: 'ACTIVE',
  })
  await prReviewLearningRepository.create({
    workspaceId: o.ws,
    memoryId: o.id,
    repo: o.repo,
    pathGlob: o.pathGlob ?? null,
    ruleId: 'vuln:x',
    fingerprint: `fp-${o.id}`,
    sourcePullRequestId: o.sourcePr,
    sourceReplyId: `reply-${o.id}`,
    authorLogin: 'alice',
  })
  if (o.repoWide)
    await harness.prisma!.prReviewLearning.updateMany({
      where: { memoryId: o.id },
      data: { repoWideAt: new Date('2026-10-01T00:00:00Z') },
    })
}

beforeAll(async () => {
  await harness.start()
  for (const [ws, project] of [
    [WS, 'p_ls'],
    [WS2, 'p_ls2'],
  ] as const) {
    await harness.insert('workspaces', { id: ws, name: ws, slug: ws })
    await harness.insert('workspace_members', {
      id: ws === WS ? OWNER : `m-${ws}`,
      workspaceId: ws,
      clerkId: `c-${ws}`,
      role: 'OWNER',
    })
    await harness.insert('teams', {
      id: `t-${ws}`,
      workspaceId: ws,
      name: 'T',
      identifier: ws === WS ? 'LSA' : 'LSB',
    })
    await harness.insert('projects', {
      id: project,
      workspaceId: ws,
      teamId: `t-${ws}`,
      createdByMemberId: ws === WS ? OWNER : `m-${ws}`,
      name: project,
    })
  }
  await harness.insert('workspace_members', {
    id: MEMBER,
    workspaceId: WS,
    clerkId: 'c-member',
    role: 'MEMBER',
  })
  for (const [id, ws, repo, number, state] of [
    ['pr-review', WS, 'acme/b', 1, 'open'],
    ['pr-a-open', WS, 'acme/a', 2, 'open'],
    ['pr-a-merged', WS, 'acme/a', 3, 'merged'],
    ['pr-tenant', WS2, 'acme/a', 4, 'merged'],
  ] as const)
    await harness.insert('pull_requests', {
      id,
      workspaceId: ws,
      repo,
      number,
      state,
    })

  await seedLearning({
    id: 'l-own',
    ws: WS,
    project: 'p_ls',
    repo: 'acme/b',
    rule: RULE.own,
    sourcePr: 'pr-review',
    repoWide: false,
  })
  await seedLearning({
    id: 'l-wide',
    ws: WS,
    project: 'p_ls',
    repo: 'acme/a',
    rule: RULE.wide,
    sourcePr: null,
    repoWide: true,
  })
  await seedLearning({
    id: 'l-missed',
    ws: WS,
    project: 'p_ls',
    repo: 'acme/a',
    rule: RULE.missedMerge,
    sourcePr: 'pr-a-merged',
    repoWide: false,
  })
  await seedLearning({
    id: 'l-pending',
    ws: WS,
    project: 'p_ls',
    repo: 'acme/a',
    rule: RULE.pending,
    sourcePr: 'pr-a-open',
    repoWide: false,
  })
  await seedLearning({
    id: 'l-docs',
    ws: WS,
    project: 'p_ls',
    repo: 'acme/a',
    rule: RULE.docs,
    sourcePr: null,
    repoWide: true,
    pathGlob: 'docs/**',
  })
  await seedLearning({
    id: 'l-tenant',
    ws: WS2,
    project: 'p_ls2',
    repo: 'acme/a',
    rule: RULE.tenant,
    sourcePr: 'pr-tenant',
    repoWide: true,
  })
})

afterAll(async () => harness.stop())

const setScope = (ws: string, scope: LearningsScope) =>
  harness.prisma!.workspace.update({
    where: { id: ws },
    data: { securityLearningsScope: scope },
  })

function review(
  visibility: RepoVisibilityReader,
  over: { workspaceId?: string; repo?: string; pullRequestId?: string } = {}
) {
  return loadReviewLearnings(
    {
      workspaceId: over.workspaceId ?? WS,
      repo: over.repo ?? 'acme/b',
      pullRequestId: over.pullRequestId ?? 'pr-review',
      reviewedPaths: ['src/app.ts'],
    },
    { repoVisibility: visibility }
  )
}

const reader = (answer: 'public' | 'private' | 'unknown') =>
  jest.fn<ReturnType<RepoVisibilityReader>, Parameters<RepoVisibilityReader>>(
    async () => answer
  )

describe('the setting', () => {
  const ctx = (memberId: string) =>
    memberAuditContext(new Headers({}), { clerkId: 'c', memberId })

  it('defaults to auto and an OWNER changes it, audited', async () => {
    const caller = { workspaceId: WS, memberId: OWNER, workspaceSlug: WS }
    expect(
      (await securityScanSettingsService.get(caller)).switches
        .securityLearningsScope
    ).toBe('auto')
    const next = await securityScanSettingsService.update(
      caller,
      { securityLearningsScope: 'global' },
      ctx(OWNER)
    )
    expect(next.switches.securityLearningsScope).toBe('global')
    const events = await harness.prisma!.auditEvent.findMany({
      where: { workspaceId: WS, action: 'workspace.security_settings_updated' },
    })
    expect(events.map(e => e.metadata)).toEqual([
      { changes: { securityLearningsScope: { from: 'auto', to: 'global' } } },
    ])
  })

  it('a MEMBER gets 403 and nothing changes', async () => {
    await expect(
      securityScanSettingsService.update(
        { workspaceId: WS, memberId: MEMBER, workspaceSlug: WS },
        { securityLearningsScope: 'local' },
        ctx(MEMBER)
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      (
        await harness.prisma!.workspace.findUniqueOrThrow({
          where: { id: WS },
          select: { securityLearningsScope: true },
        })
      ).securityLearningsScope
    ).toBe('global')
  })

  it('only local | global | auto are accepted — by the route schema and the column', async () => {
    expect(
      updateSecurityScanSettingsSchema.safeParse({
        securityLearningsScope: 'org',
      }).success
    ).toBe(false)
    expect(
      updateSecurityScanSettingsSchema.safeParse({
        securityLearningsScope: 'local',
      }).success
    ).toBe(true)
    await expect(
      harness.query(
        `update workspaces set "securityLearningsScope" = 'org' where id = $1`,
        [WS2]
      )
    ).rejects.toThrow()
  })
})

describe('which learnings reach the review', () => {
  it('local ⇒ only the reviewed repository’s learnings; GitHub is not asked', async () => {
    await setScope(WS, 'local')
    const vis = reader('private')
    const block = await review(vis)
    expect(block).toContain(RULE.own)
    expect(block).not.toContain(RULE.wide)
    expect(block).not.toContain(RULE.missedMerge)
    expect(vis).not.toHaveBeenCalled()
  })

  it('global ⇒ the workspace’s other repositories’ repository-wide, relevant learnings too (own first)', async () => {
    await setScope(WS, 'global')
    const vis = reader('public')
    const block = await review(vis)
    expect(block).toContain(RULE.own)
    expect(block).toContain(RULE.wide)
    // A merge the promotion missed still counts (source PR state).
    expect(block).toContain(RULE.missedMerge)
    // An open PR's learning stays with that PR of that repository.
    expect(block).not.toContain(RULE.pending)
    // Relevance filtering still applies (docs/** vs src/app.ts).
    expect(block).not.toContain(RULE.docs)
    expect(block).not.toContain(RULE.tenant)
    expect(block.indexOf(RULE.own)).toBeLessThan(block.indexOf(RULE.wide))
    expect(vis).not.toHaveBeenCalled()
  })

  it('auto ⇒ private repository behaves as global, public and unknown as local', async () => {
    await setScope(WS, 'auto')
    const priv = reader('private')
    const privBlock = await review(priv)
    expect(privBlock).toContain(RULE.wide)
    expect(privBlock).toContain(RULE.own)
    expect(priv).toHaveBeenCalledWith({
      workspaceId: WS,
      fullName: 'acme/b',
    })

    for (const answer of ['public', 'unknown'] as const) {
      const block = await review(reader(answer))
      expect(block).toContain(RULE.own)
      expect(block).not.toContain(RULE.wide)
      expect(block).not.toContain(RULE.missedMerge)
    }
    // A reader that fails is unknown: local.
    const failing = jest.fn(async () => {
      throw new Error('GitHub down')
    })
    const failed = await review(failing)
    expect(failed).toContain(RULE.own)
    expect(failed).not.toContain(RULE.wide)
  })

  it('auto asks GitHub only when another repository has a learning that would apply', async () => {
    await setScope(WS, 'auto')
    const vis = reader('private')
    // acme/a's own review: the only other repository in WS is acme/b, whose
    // one learning is PR-only (its source PR is open) — nothing to decide.
    const block = await review(vis, {
      repo: 'acme/a',
      pullRequestId: 'pr-a-open',
    })
    expect(block).toContain(RULE.wide)
    expect(block).toContain(RULE.pending)
    expect(block).not.toContain(RULE.own)
    expect(vis).not.toHaveBeenCalled()
  })

  it('another workspace’s learnings never appear, under any scope', async () => {
    for (const scope of ['local', 'global', 'auto'] as const) {
      await setScope(WS, scope)
      await setScope(WS2, scope)
      const block = await review(reader('private'))
      expect(block).not.toContain(RULE.tenant)
      // And the other way round: WS2 reviewing a repository WS also has.
      const other = await review(reader('private'), {
        workspaceId: WS2,
        repo: 'acme/b',
        pullRequestId: 'pr-tenant',
      })
      for (const rule of [RULE.own, RULE.wide, RULE.missedMerge])
        expect(other).not.toContain(rule)
      if (scope !== 'local') expect(other).toContain(RULE.tenant)
      else expect(other).toBe('')
    }
  })
})
