/**
 * Single source for the third parties Lumo sends customer data to (LUM-856).
 *
 * The public /security page renders from this list, and
 * `__tests__/lib/legal/subprocessors.test.ts` fails when it drifts from:
 *   - the legal subprocessor doc (`docs/live-docs/legal-subprocessors.md`,
 *     LUM-857) — same entities and services, in both directions;
 *   - the LLM hosts that `lib/ai/models.ts` actually reaches under zero data
 *     retention, as recorded in `docs/privacy/llm-data-flow.md` (LUM-854).
 *
 * Changing a model or adding a runtime service therefore means updating the
 * manifest, the legal doc and this file together.
 *
 * LUM-919: every addition, replacement, change or removal of an
 * infrastructure or AI host entry also needs a record in
 * `lib/legal/subprocessor-changes.ts`, announced at least 30 days before it
 * takes effect (DPA 7.2); `__tests__/lib/legal/subprocessor-change-log.test.ts`
 * fails otherwise. Read that file's header before editing these lists.
 *
 * Only facts live here. Purpose / location wording is translated on the page
 * (`security.subprocessors.*` keys) and keyed by `id`.
 */

/** Where vulnerability reports go — also the Contact in security.txt. */
export const SECURITY_CONTACT_EMAIL = 'hello@uselumo.ai'

/** Date the /security page and this list were last reviewed (ISO). */
export const SECURITY_PAGE_UPDATED = '2026-10-12'

/**
 * `us`: United States. `globalEdge`: served from the edge, nothing retained.
 * `globalRouting`: AI requests use the gateway's default `global` region, so
 * the processing location is not fixed and not committed to (LUM-854 manifest,
 * "数据地域").
 */
export type DataLocation = 'us' | 'globalEdge' | 'globalRouting'

export interface InfrastructureSubprocessor {
  id: string
  /** Legal entity, exactly as the legal doc's "Subprocessor" cell. */
  entity: string
  /** Exactly the legal doc's "Service" cell. */
  docService: string
  /** Product name shown on the page (a proper noun, not translated). */
  product: string
  location: DataLocation
  /** Optional region detail shown next to the location. */
  region?: string
}

export interface AiHostSubprocessor {
  /** AI Gateway provider slug, as in the LUM-854 manifest. */
  gatewaySlug: string
  /** Exactly the legal doc's "Subprocessor" cell. */
  entity: string
  location: DataLocation
}

export interface CustomerIntegration {
  id: string
  /** Exactly the legal doc's "Service" cell. */
  service: string
  /** Exactly the legal doc's "Provider" cell. */
  provider: string
  /** Product name shown on the page. */
  product: string
}

export const INFRASTRUCTURE_SUBPROCESSORS: readonly InfrastructureSubprocessor[] =
  [
    {
      id: 'vercelHosting',
      entity: 'Vercel Inc.',
      docService: 'Hosting and serverless functions',
      product: 'Vercel',
      location: 'us',
    },
    {
      id: 'vercelBlob',
      entity: 'Vercel Inc.',
      docService: 'Vercel Blob',
      product: 'Vercel Blob',
      location: 'us',
    },
    {
      id: 'vercelSandbox',
      entity: 'Vercel Inc.',
      docService: 'Vercel Sandbox',
      product: 'Vercel Sandbox',
      location: 'us',
    },
    {
      id: 'vercelAiGateway',
      entity: 'Vercel Inc.',
      docService: 'Vercel AI Gateway',
      product: 'Vercel AI Gateway',
      location: 'globalEdge',
    },
    {
      id: 'neon',
      entity: 'Neon Inc. (a Databricks company)',
      docService: 'Serverless Postgres',
      product: 'Neon Postgres',
      location: 'us',
      region: 'AWS us-east-1',
    },
    {
      id: 'clerk',
      entity: 'Clerk Inc.',
      docService: 'Authentication',
      product: 'Clerk',
      location: 'us',
    },
    {
      id: 'pusher',
      entity: 'Pusher Ltd.',
      docService: 'Pusher Channels',
      product: 'Pusher Channels',
      location: 'us',
    },
    {
      id: 'upstash',
      entity: 'Upstash Inc. (via Vercel KV)',
      docService: 'Redis key-value store',
      product: 'Upstash Redis',
      location: 'us',
    },
    {
      id: 'resend',
      entity: 'Resend Inc.',
      docService: 'Transactional email',
      product: 'Resend',
      location: 'us',
    },
  ]

/**
 * Every host the AI Gateway may route a Lumo model request to under forced
 * zero data retention. Model authors' own APIs (DeepSeek, Zhipu) are excluded
 * by the gateway and must never appear here.
 */
export const AI_HOST_SUBPROCESSORS: readonly AiHostSubprocessor[] = [
  {
    gatewaySlug: 'openai',
    entity: 'OpenAI, L.L.C.',
    location: 'globalRouting',
  },
  {
    // LUM-988: the AI review (CODE_REVIEW_MODEL) is pinned to Anthropic's own
    // API by MODEL_PROVIDER_PINS; bedrock / vertexAnthropic / claudeaws are
    // never reached.
    gatewaySlug: 'anthropic',
    entity: 'Anthropic, PBC',
    location: 'globalRouting',
  },
  {
    gatewaySlug: 'azure',
    entity: 'Microsoft Corporation (Azure)',
    location: 'globalRouting',
  },
  {
    gatewaySlug: 'alibaba',
    entity: 'Alibaba Cloud',
    location: 'globalRouting',
  },
  {
    gatewaySlug: 'baseten',
    entity: 'Baseten, Inc.',
    location: 'globalRouting',
  },
  {
    gatewaySlug: 'deepinfra',
    entity: 'DeepInfra, Inc.',
    location: 'globalRouting',
  },
  {
    gatewaySlug: 'digitalocean',
    entity: 'DigitalOcean, LLC',
    location: 'globalRouting',
  },
  {
    gatewaySlug: 'togetherai',
    entity: 'Together Computer, Inc. (Together AI)',
    location: 'globalRouting',
  },
  { gatewaySlug: 'nebius', entity: 'Nebius B.V.', location: 'globalRouting' },
  { gatewaySlug: 'parasail', entity: 'Parasail', location: 'globalRouting' },
  { gatewaySlug: 'runware', entity: 'Runware', location: 'globalRouting' },
  { gatewaySlug: 'wafer', entity: 'Wafer', location: 'globalRouting' },
]

/** Services that only receive data once a workspace member connects them. */
export const CUSTOMER_INTEGRATIONS: readonly CustomerIntegration[] = [
  {
    id: 'github',
    service: 'GitHub App and GitHub account link',
    provider: 'GitHub, Inc.',
    product: 'GitHub',
  },
  {
    id: 'slack',
    service: 'Slack',
    provider: 'Slack Technologies, LLC',
    product: 'Slack',
  },
  { id: 'figma', service: 'Figma', provider: 'Figma, Inc.', product: 'Figma' },
  {
    id: 'googleDrive',
    service: 'Google Drive',
    provider: 'Google LLC',
    product: 'Google Drive',
  },
  {
    id: 'sentry',
    service: 'Sentry',
    provider: 'Functional Software, Inc. (Sentry)',
    product: 'Sentry',
  },
]
