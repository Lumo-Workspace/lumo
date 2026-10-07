/**
 * LUM-1019 — which backend serves Lumo's model calls. Pure: reads an env
 * object, imports no provider SDK, so services and tests can ask "is AI
 * configured?" without pulling `@ai-sdk/*` into scope. The providers
 * themselves are built in `lib/ai/gateway.ts`, the only module allowed to.
 *
 * | Route    | Selected when                                         | Serves                                    |
 * | -------- | ----------------------------------------------------- | ----------------------------------------- |
 * | gateway  | AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN or VERCEL=1     | every model id, ZDR forced (SaaS default) |
 * | direct   | ANTHROPIC_API_KEY and/or OPENAI_COMPATIBLE_BASE_URL   | ids mappable to the configured provider   |
 * | none     | nothing above                                         | nothing: calls throw AiNotConfiguredError |
 *
 * `AI_PROVIDER=gateway|direct|none` overrides the automatic choice. The
 * gateway wins the automatic choice, so a Vercel deployment keeps routing
 * through it even when a provider key is also present.
 *
 * Zero data retention is enforced only on the gateway route (see
 * `zdr-fetch.ts`). A self-hoster who routes direct is responsible for the
 * retention terms of the provider they point Lumo at.
 */

export type AiEnv = Readonly<Record<string, string | undefined>>

export interface AnthropicDirectConfig {
  apiKey: string
  baseURL?: string
  /** Claude model used for ids no direct provider can serve (ANTHROPIC_MODEL). */
  fallbackModel?: string
}

export interface OpenAICompatibleDirectConfig {
  baseURL: string
  apiKey?: string
  /** One model for every chat id (OPENAI_COMPATIBLE_MODEL), e.g. an Ollama tag. */
  model?: string
  /** Embedding model (OPENAI_COMPATIBLE_EMBEDDING_MODEL); must return 1024-d vectors. */
  embeddingModel?: string
  /**
   * Send the JSON schema as `response_format: json_schema` (OpenAI, vLLM,
   * Ollama and LM Studio accept it). OPENAI_COMPATIBLE_STRUCTURED_OUTPUTS=false
   * falls back to plain `json_object` for endpoints that reject it.
   */
  structuredOutputs: boolean
}

export type AiRoute =
  | { kind: 'gateway' }
  | {
      kind: 'direct'
      anthropic?: AnthropicDirectConfig
      openaiCompatible?: OpenAICompatibleDirectConfig
    }
  | { kind: 'none' }

export type DirectProviderName = 'anthropic' | 'openai-compatible'

export interface DirectModelTarget {
  provider: DirectProviderName
  modelId: string
}

const AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED'
const AI_MODEL_UNAVAILABLE = 'AI_MODEL_UNAVAILABLE'

/** No AI backend is configured: AI features are off on this deployment. */
export class AiNotConfiguredError extends Error {
  readonly status = 503
  readonly code = AI_NOT_CONFIGURED
  constructor() {
    super(
      'AI is not configured on this deployment. Set AI_GATEWAY_API_KEY, ANTHROPIC_API_KEY or OPENAI_COMPATIBLE_BASE_URL.'
    )
    this.name = 'AiNotConfiguredError'
  }
}

/** A direct provider is configured but cannot serve this model id. */
export class AiModelUnavailableError extends Error {
  readonly status = 503
  readonly code = AI_MODEL_UNAVAILABLE
  constructor(
    readonly modelId: string,
    hint: string
  ) {
    super(`AI model ${modelId} is not available on this deployment: ${hint}`)
    this.name = 'AiModelUnavailableError'
  }
}

/** True for either "AI is off" error — callers that degrade check this. */
export function isAiUnavailableError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === AI_NOT_CONFIGURED || code === AI_MODEL_UNAVAILABLE
}

const value = (env: AiEnv, key: string): string | undefined => {
  const v = env[key]?.trim()
  return v ? v : undefined
}

function gatewayConfigured(env: AiEnv): boolean {
  return Boolean(
    value(env, 'AI_GATEWAY_API_KEY') ||
    value(env, 'VERCEL_OIDC_TOKEN') ||
    value(env, 'VERCEL') === '1'
  )
}

/** `{ [key]: v }` when `v` is set, else `{}` (exactOptionalPropertyTypes). */
function opt<K extends string>(
  key: K,
  v: string | undefined
): Partial<Record<K, string>> {
  return v === undefined ? {} : ({ [key]: v } as Record<K, string>)
}

function directRoute(env: AiEnv): AiRoute {
  const anthropicKey = value(env, 'ANTHROPIC_API_KEY')
  const compatBase = value(env, 'OPENAI_COMPATIBLE_BASE_URL')
  if (!anthropicKey && !compatBase) return { kind: 'none' }
  const route: Extract<AiRoute, { kind: 'direct' }> = { kind: 'direct' }
  if (anthropicKey) {
    route.anthropic = {
      apiKey: anthropicKey,
      ...opt('baseURL', value(env, 'ANTHROPIC_BASE_URL')),
      ...opt('fallbackModel', value(env, 'ANTHROPIC_MODEL')),
    }
  }
  if (compatBase) {
    route.openaiCompatible = {
      baseURL: compatBase,
      structuredOutputs:
        value(env, 'OPENAI_COMPATIBLE_STRUCTURED_OUTPUTS')?.toLowerCase() !==
        'false',
      ...opt('apiKey', value(env, 'OPENAI_COMPATIBLE_API_KEY')),
      ...opt('model', value(env, 'OPENAI_COMPATIBLE_MODEL')),
      ...opt('embeddingModel', value(env, 'OPENAI_COMPATIBLE_EMBEDDING_MODEL')),
    }
  }
  return route
}

/** The route for `env` (defaults to `process.env`). */
export function resolveAiRoute(env: AiEnv = process.env): AiRoute {
  const forced = value(env, 'AI_PROVIDER')?.toLowerCase()
  if (forced === 'none') return { kind: 'none' }
  if (forced === 'gateway') return { kind: 'gateway' }
  if (forced === 'direct') return directRoute(env)
  if (forced !== undefined) {
    throw new Error(
      `AI_PROVIDER must be gateway, direct or none (got "${forced}")`
    )
  }
  return gatewayConfigured(env) ? { kind: 'gateway' } : directRoute(env)
}

/** Can this deployment make model calls at all? */
export function isAiConfigured(env: AiEnv = process.env): boolean {
  return resolveAiRoute(env).kind !== 'none'
}

/**
 * Anthropic's API names models with dashes where the gateway uses a version
 * dot: `claude-sonnet-4.6` → `claude-sonnet-4-6`.
 */
export function anthropicNativeModelId(gatewayName: string): string {
  return gatewayName.replace(/\./g, '-')
}

function splitGatewayId(id: string): { prefix: string | null; name: string } {
  const slash = id.indexOf('/')
  return slash === -1
    ? { prefix: null, name: id }
    : { prefix: id.slice(0, slash), name: id.slice(slash + 1) }
}

/**
 * Map a gateway-format chat model id (`anthropic/claude-sonnet-5.5`) to the
 * direct provider that serves it:
 *   1. an `anthropic/…` id goes to Anthropic when ANTHROPIC_API_KEY is set;
 *   2. anything else goes to the OpenAI-compatible endpoint — as
 *      OPENAI_COMPATIBLE_MODEL when set, else with the provider prefix
 *      stripped (`openai/gpt-5.5` → `gpt-5.5`);
 *   3. with Anthropic only, non-Claude ids go to ANTHROPIC_MODEL when set.
 * Otherwise the id has no direct mapping and this throws.
 */
export function directLanguageModelTarget(
  route: Extract<AiRoute, { kind: 'direct' }>,
  gatewayId: string
): DirectModelTarget {
  const { prefix, name } = splitGatewayId(gatewayId)
  const isClaude =
    prefix === 'anthropic' || (prefix === null && name.startsWith('claude-'))
  if (isClaude && route.anthropic) {
    return { provider: 'anthropic', modelId: anthropicNativeModelId(name) }
  }
  if (route.openaiCompatible) {
    return {
      provider: 'openai-compatible',
      modelId: route.openaiCompatible.model ?? name,
    }
  }
  if (route.anthropic?.fallbackModel) {
    return { provider: 'anthropic', modelId: route.anthropic.fallbackModel }
  }
  throw new AiModelUnavailableError(
    gatewayId,
    'only Claude models are served by ANTHROPIC_API_KEY; set ANTHROPIC_MODEL to use a Claude model for it, or configure OPENAI_COMPATIBLE_BASE_URL'
  )
}

/** The direct embedding target. Only the OpenAI-compatible endpoint embeds. */
export function directEmbeddingModelTarget(
  route: Extract<AiRoute, { kind: 'direct' }>,
  gatewayId: string
): DirectModelTarget {
  const model = route.openaiCompatible?.embeddingModel
  if (model) return { provider: 'openai-compatible', modelId: model }
  throw new AiModelUnavailableError(
    gatewayId,
    'embeddings need OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_EMBEDDING_MODEL (a 1024-dimension model)'
  )
}
