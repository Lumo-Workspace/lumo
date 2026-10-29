import { z } from 'zod'
import {
  AGENT_REVIEW_KINDS,
  AGENT_REVIEW_TOOLS,
} from '@/shared/src/security-scan'
import { sarifClientPayloadSchema } from './security-sarif'

/**
 * LUM-1321 — body of `POST /api/workspaces/me/security-scan/import`: a
 * security review the developer ran in Claude Code or Codex, as SARIF 2.1.0
 * (the CLI converts its simpler JSON format before sending). The SARIF itself
 * is checked by the ingest parser, not here.
 */
export const AGENT_IMPORT_MAX_BYTES = 1024 * 1024

export const agentImportBodySchema = sarifClientPayloadSchema
  .pick({ repository: true, prNumber: true })
  .extend({
    // Full SHA: it is compared with the PR's head.
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
    tool: z.enum(AGENT_REVIEW_TOOLS),
    /** LUM-1333: a code review's bugs, or (default) a security review. */
    kind: z.enum(AGENT_REVIEW_KINDS).default('security'),
    sarif: z.record(z.string(), z.unknown()),
  })
  .strict()

export type AgentImportBody = z.infer<typeof agentImportBodySchema>
