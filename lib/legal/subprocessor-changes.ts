/**
 * LUM-919: the subprocessor change log — the record behind DPA §7.2 ("Lumo
 * will notify Customer of any intended addition or replacement of a
 * Subprocessor at least 30 days before the change takes effect").
 *
 * Every addition, replacement, change of purpose or data location, and
 * removal of an entry in `lib/legal/subprocessors.ts` (infrastructure and AI
 * hosts) is recorded here with the date it is announced and the date it takes
 * effect. `__tests__/lib/legal/subprocessor-change-log.test.ts` replays
 * SUBPROCESSOR_BASELINE + SUBPROCESSOR_CHANGES and fails when the registry
 * differs from the result, or when a change gives less than
 * NOTICE_PERIOD_DAYS of notice without being marked urgent.
 *
 * Customer-enabled integrations (CUSTOMER_INTEGRATIONS) are not subprocessors
 * — the customer connects them under its own agreement (legal doc, "Customer-
 * enabled integrations") — so they are outside this log.
 *
 * How to announce a change:
 *   1. Add the record below (announcedAt = the day it is published, at least
 *      NOTICE_PERIOD_DAYS before effectiveAt unless urgent) and change the
 *      registry and `docs/live-docs/legal-subprocessors.md` in the same PR —
 *      its tables, and its "Change history" (a table
 *      `| Change | Announced | Takes effect | Summary |` with one row per
 *      record, replacing the "No changes" line; the drift test checks it).
 *      /security shows the change as upcoming and keeps showing the previous
 *      state as in use until effectiveAt.
 *   2. After merge and deploy, upload the legal doc and run
 *      `scripts/subprocessor-notice/send.ts` (dry run, then --confirm) to
 *      email the owners of every workspace.
 *   3. The code that starts using the new subprocessor ships on or after
 *      effectiveAt.
 * A removal needs no notice; record it with effectiveAt = the day it stops.
 * A change of purpose is not visible to the guard (purpose wording lives in
 * the legal doc and the `security.subprocessors.purpose.*` keys, not in the
 * registry), so it is recorded by hand: kind `changed` with identical
 * before/after entries, the new purpose in `summary`.
 */
import type {
  AiHostSubprocessor,
  InfrastructureSubprocessor,
} from '@/lib/legal/subprocessors'

/** DPA §7.2 notice period, in days. */
export const NOTICE_PERIOD_DAYS = 30

/** Where customers send an objection (DPA §7.3) and notification requests. */
export const PRIVACY_CONTACT_EMAIL = 'privacy@uselumo.ai'

/** Public /security page; the change list is the `#subprocessor-changes` anchor. */
export const PUBLIC_SECURITY_URL = 'https://www.uselumo.ai/security'

/** /security lists changes that took effect within this many days. */
export const RECENT_CHANGE_DAYS = 365

export type SubprocessorChangeKind =
  | 'added'
  | 'replaced'
  | 'changed'
  | 'removed'

/** One registry entry, tagged with the list it lives in. */
export type SubprocessorRef =
  | { list: 'infrastructure'; entry: InfrastructureSubprocessor }
  | { list: 'aiHost'; entry: AiHostSubprocessor }

export interface SubprocessorChange {
  /** Stable id, `YYYY-MM-DD-<slug>`; the send script and its records key on it. */
  id: string
  /**
   * added: `after` only. removed: `before` only. replaced: `before` (the
   * subprocessor being replaced) and `after` (the new one), different entries.
   * changed: the same entry before and after (a new data location, region or
   * service, or — facts unchanged — a new purpose described in `summary`).
   */
  kind: SubprocessorChangeKind
  /** UTC calendar day the change is published (this page + email). */
  announcedAt: string
  /** UTC calendar day the change takes effect (00:00 UTC). */
  effectiveAt: string
  /** Present = needed urgently to keep the service secure or available. */
  urgent?: { reason: string }
  /** One English sentence for the email and the legal doc. */
  summary: string
  before?: SubprocessorRef
  after?: SubprocessorRef
}

/**
 * The registry as of 2026-10-05, when the change log started: subject →
 * fingerprint (see `subprocessorFingerprint`). Frozen — never edit it; record
 * a change instead.
 */
export const SUBPROCESSOR_BASELINE_DATE = '2026-10-05'
export const SUBPROCESSOR_BASELINE: Readonly<Record<string, string>> = {
  'infrastructure:vercelHosting':
    'Vercel Inc. | Hosting and serverless functions | Vercel | us',
  'infrastructure:vercelBlob': 'Vercel Inc. | Vercel Blob | Vercel Blob | us',
  'infrastructure:vercelSandbox':
    'Vercel Inc. | Vercel Sandbox | Vercel Sandbox | us',
  'infrastructure:vercelAiGateway':
    'Vercel Inc. | Vercel AI Gateway | Vercel AI Gateway | globalEdge',
  'infrastructure:neon':
    'Neon Inc. (a Databricks company) | Serverless Postgres | Neon Postgres | us | AWS us-east-1',
  'infrastructure:clerk': 'Clerk Inc. | Authentication | Clerk | us',
  'infrastructure:pusher':
    'Pusher Ltd. | Pusher Channels | Pusher Channels | us',
  'infrastructure:upstash':
    'Upstash Inc. (via Vercel KV) | Redis key-value store | Upstash Redis | us',
  'infrastructure:resend': 'Resend Inc. | Transactional email | Resend | us',
  'aiHost:openai': 'OpenAI, L.L.C. | globalRouting',
  'aiHost:anthropic': 'Anthropic, PBC | globalRouting',
  'aiHost:azure': 'Microsoft Corporation (Azure) | globalRouting',
  'aiHost:alibaba': 'Alibaba Cloud | globalRouting',
  'aiHost:baseten': 'Baseten, Inc. | globalRouting',
  'aiHost:deepinfra': 'DeepInfra, Inc. | globalRouting',
  'aiHost:digitalocean': 'DigitalOcean, LLC | globalRouting',
  'aiHost:togetherai': 'Together Computer, Inc. (Together AI) | globalRouting',
  'aiHost:nebius': 'Nebius B.V. | globalRouting',
  'aiHost:parasail': 'Parasail | globalRouting',
  'aiHost:runware': 'Runware | globalRouting',
  'aiHost:wafer': 'Wafer | globalRouting',
}

/** Oldest first (by announcedAt). Append only — a sent change is never edited. */
export const SUBPROCESSOR_CHANGES: readonly SubprocessorChange[] = []
