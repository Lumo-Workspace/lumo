/**
 * LUM-1065 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §4, decision
 * Q4 option A) — the security plugin's columns on core models.
 *
 * `Workspace.{securityPolicy, securityScanEnabled, securityAiReviewEnabled,
 * securityHuntEnabled, securityRequestChangesEnabled, securityLearningsScope,
 * scanEvidenceRetentionDays}` and
 * `ProjectRepository.{lastSarifIngestAt, securityBaseline}` stay in the one
 * core schema (migrations are never deleted), but only the plugin reads or
 * writes them. These queries moved here unchanged from the core
 * `workspaceRepository` / `projectRepository`; settings writes from
 * `PATCH /api/workspaces/me` still go through the `workspaceSettings`
 * extension point (ee/security/workspace-settings.ts).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { scopedPrisma } from '@/lib/db/workspace-scope'
import type { SecurityBaseline } from '@/ee/security/security-scan/types'
import {
  parseLearningsScope,
  type LearningsScope,
} from '@/ee/security/security-scan/learnings-scope'

export const securityColumnsRepository = {
  // ── Workspace ──────────────────────────────────────────────────────────────

  /** LUM-911 — each workspace's scan evidence retention, in days. */
  async findScanEvidenceRetention(
    workspaceIds: string[]
  ): Promise<Map<string, number>> {
    if (workspaceIds.length === 0) return new Map()
    const rows = await prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true, scanEvidenceRetentionDays: true },
    })
    return new Map(rows.map(row => [row.id, row.scanEvidenceRetentionDays]))
  },

  /** LUM-911 — workspaces that keep no scan evidence once a scan is final. */
  async findZeroScanEvidenceRetentionIds(): Promise<string[]> {
    const rows = await prisma.workspace.findMany({
      where: { scanEvidenceRetentionDays: 0 },
      select: { id: true },
    })
    return rows.map(row => row.id)
  },

  /** LUM-740: the raw `securityPolicy` Json column (null when unset or the
   *  workspace is missing) — parse with `parseSecurityPolicy`. */
  async findSecurityPolicy(id: string): Promise<unknown> {
    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { securityPolicy: true },
    })
    return row?.securityPolicy ?? null
  },

  /** LUM-1130: is the request-changes workflow on? false when the workspace
   *  is missing. */
  async findRequestChangesEnabled(id: string): Promise<boolean> {
    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { securityRequestChangesEnabled: true },
    })
    return row?.securityRequestChangesEnabled === true
  },

  /** LUM-1134: the learnings scope (local | global | auto); the default
   *  (auto) when the workspace is missing or the value is unrecognised. */
  async findLearningsScope(id: string): Promise<LearningsScope> {
    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { securityLearningsScope: true },
    })
    return parseLearningsScope(row?.securityLearningsScope)
  },

  /** LUM-866: the three security-scan switches (+ LUM-1130's request-changes
   *  workflow and LUM-1134's learnings scope); null when the workspace is
   *  missing — resolve with `resolveSecurityLayers`. */
  async findSecuritySwitches(id: string) {
    const row = await prisma.workspace.findUnique({
      where: { id },
      select: {
        securityScanEnabled: true,
        securityAiReviewEnabled: true,
        securityHuntEnabled: true,
        securityRequestChangesEnabled: true,
        securityLearningsScope: true,
      },
    })
    if (!row) return null
    return {
      ...row,
      securityLearningsScope: parseLearningsScope(row.securityLearningsScope),
    }
  },

  // ── ProjectRepository (tenant-scoped client, as in projectRepository) ────

  /**
   * LUM-735 — has this repo ever pushed a SARIF report? `undefined` = the
   * repo is not linked in this workspace at all; `null` = linked but never
   * ingested (panel: NOT_CONFIGURED); a Date = ingested before (panel: PENDING
   * until this sha's report lands).
   */
  async findLastSarifIngestAt(
    workspaceId: string,
    fullName: string
  ): Promise<Date | null | undefined> {
    const row = await scopedPrisma.projectRepository.findFirst({
      where: { fullName, project: { workspaceId } },
      orderBy: { lastSarifIngestAt: { sort: 'desc', nulls: 'last' } },
      select: { lastSarifIngestAt: true },
    })
    if (!row) return undefined
    return row.lastSarifIngestAt
  },

  async markSarifIngested(
    workspaceId: string,
    fullName: string,
    at: Date
  ): Promise<number> {
    const res = await scopedPrisma.projectRepository.updateMany({
      where: { fullName, project: { workspaceId } },
      data: { lastSarifIngestAt: at },
    })
    return res.count
  },

  /**
   * LUM-738 — the default branch's security baseline for a repo. `undefined`
   * = the repo is not linked in this workspace; `null` = never scanned; a
   * baseline with `at: null` = a run was requested and has not landed.
   */
  async findSecurityBaseline(
    workspaceId: string,
    fullName: string
  ): Promise<SecurityBaseline | null | undefined> {
    const row = await scopedPrisma.projectRepository.findFirst({
      where: { fullName, project: { workspaceId } },
      orderBy: { createdAt: 'asc' },
      select: { securityBaseline: true },
    })
    if (!row) return undefined
    return (row.securityBaseline as SecurityBaseline | null) ?? null
  },

  /** LUM-738 — replace the baseline on every linked row of that repo in the workspace. */
  async setSecurityBaseline(
    workspaceId: string,
    fullName: string,
    baseline: SecurityBaseline
  ): Promise<number> {
    const res = await scopedPrisma.projectRepository.updateMany({
      where: { fullName, project: { workspaceId } },
      data: { securityBaseline: baseline as unknown as Prisma.InputJsonValue },
    })
    return res.count
  },
}
