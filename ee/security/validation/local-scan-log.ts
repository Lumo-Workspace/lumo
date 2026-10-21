import { z } from 'zod'

/**
 * LUM-1259 — `POST /api/workspaces/me/security-scan/local-runs`: the local
 * scan results `lumo security scan --log` uploads, one run per commit. A
 * batch, so the pre-push range and a flushed offline queue go in one call.
 *
 * Objects strip unknown keys (never `.strict()`): whatever a client sends
 * beyond these fields — an `evidence` line, a commit message — is dropped
 * here and never reaches the database.
 */

/** Runs per request (the CLI sends at most this many per call). */
export const LOCAL_SCAN_RUNS_MAX = 50

/** Findings stored per run; the CLI keeps the most severe ones. */
export const LOCAL_SCAN_FINDINGS_MAX = 200

export const LOCAL_SCAN_TITLE_MAX = 300

/** The server statuses a finding was labelled with (cli/src/lib/scan-labels.ts). */
export const LOCAL_SCAN_LABELS = [
  'NEW',
  'ON_MAIN',
  'FALSE_POSITIVE',
  'ACCEPTED_RISK',
  'LEARNING',
] as const

/** The local scanners (cli/src/lib/local-scan-report.ts LOCAL_SCANNERS). */
export const LOCAL_SCANNERS = ['SECRETS', 'DEPS'] as const

const sha = z
  .string()
  .regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, 'must be a full commit sha')

const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(v => !/[\n\r]/.test(v), 'must be a single line')

export const localScanFindingSchema = z.object({
  scanner: z.enum(LOCAL_SCANNERS),
  fingerprint: z.string().regex(/^[0-9a-f]{8,64}$/, 'must be a hex hash'),
  ruleId: singleLine(200),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  filePath: singleLine(1024),
  line: z.number().int().min(0).max(10_000_000),
  title: z.string().max(LOCAL_SCAN_TITLE_MAX * 4),
  label: z.enum(LOCAL_SCAN_LABELS).nullable(),
})

export const localScanRunSchema = z
  .object({
    repo: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^/\s]+\/[^/\s]+$/, 'must be owner/name'),
    commitSha: sha,
    parentSha: sha.nullable(),
    patchId: z
      .string()
      .regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, 'must be a patch-id')
      .nullable(),
    branch: singleLine(255).nullable(),
    sessionId: singleLine(200).nullable(),
    actor: z.enum(['USER', 'AGENT']),
    trigger: z.enum(['POST_COMMIT', 'PRE_PUSH', 'MANUAL']),
    scanners: z.array(z.enum(LOCAL_SCANNERS)).min(1).max(5),
    scannerVersion: z
      .string()
      .max(100)
      .regex(/^[\w@.;:-]+$/, 'e.g. secrets@1'),
    cliVersion: z
      .string()
      .max(50)
      .regex(/^[\w.+-]+$/)
      .nullable(),
    filesScanned: z.number().int().min(0).max(1_000_000),
    findingCount: z.number().int().min(0).max(1_000_000),
    scannedAt: z.string().datetime(),
    findings: z.array(localScanFindingSchema).max(LOCAL_SCAN_FINDINGS_MAX),
  })
  .refine(r => r.findingCount >= r.findings.length, {
    message: 'findingCount is less than the findings sent',
    path: ['findingCount'],
  })

export const localScanUploadSchema = z.object({
  version: z.literal(1),
  runs: z.array(localScanRunSchema).min(1).max(LOCAL_SCAN_RUNS_MAX),
})

export type LocalScanRunInput = z.infer<typeof localScanRunSchema>
export type LocalScanFindingInput = z.infer<typeof localScanFindingSchema>
export type LocalScanUpload = z.infer<typeof localScanUploadSchema>
