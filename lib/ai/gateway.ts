import { createAnthropic } from '@ai-sdk/anthropic'
import { createGatewayProvider } from '@ai-sdk/gateway'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  AiModelUnavailableError,
  AiNotConfiguredError,
  directEmbeddingModelTarget,
  directLanguageModelTarget,
  resolveAiRoute,
  type AiRoute,
  type DirectModelTarget,
} from './routing'
import { createZdrFetch } from './zdr-fetch'

/**
 * The only model provider runtime code may use (LUM-854). Same API as
 * `@ai-sdk/gateway`'s default `gateway` — `gateway(id)` for chat,
 * `gateway.textEmbeddingModel(id)` for embeddings — taking gateway-format ids
 * from `lib/ai/models.ts`.
 *
 * LUM-1019 — each call is routed by `resolveAiRoute()` (see `./routing`):
 *   - gateway (SaaS default, AI_GATEWAY_API_KEY locally / Vercel OIDC in prod):
 *     every inference request is forced to zero data retention by
 *     `createZdrFetch`, exactly as before;
 *   - direct (self-hosting with ANTHROPIC_API_KEY and/or an
 *     OPENAI_COMPATIBLE_BASE_URL): the id is mapped to the provider's own id.
 *     No ZDR enforcement — the self-hoster owns that provider relationship;
 *   - none: getting a model throws `AiNotConfiguredError`.
 * The route is read per call, so the env is what decides, not import order.
 *
 * Never import `gateway` from `@ai-sdk/gateway` or `ai` (which re-exports the
 * unwrapped one), nor any other provider SDK — and every module that imports
 * an AI SDK model function from `ai` must also carry the bare side-effect
 * import `import '@/lib/ai/gateway'`: a named import the module leaves unused
 * is dropped by the compiler, and then string model ids skip this router
 * (LUM-877). `__tests__/lib/ai/zdr-gateway.test.ts` fails the build otherwise.
 */
const zdrGateway = createGatewayProvider({
  fetch: createZdrFetch((input, init) => fetch(input, init)),
})

type LanguageModel = ReturnType<typeof zdrGateway.languageModel>
type EmbeddingModel = ReturnType<typeof zdrGateway.embeddingModel>
type ImageModel = ReturnType<typeof zdrGateway.imageModel>
type DirectRoute = Extract<AiRoute, { kind: 'direct' }>

const plainFetch: typeof fetch = (input, init) => fetch(input, init)

interface DirectProviders {
  anthropic?: ReturnType<typeof createAnthropic>
  openaiCompatible?: ReturnType<typeof createOpenAICompatible>
}

let directCache: { key: string; providers: DirectProviders } | null = null

/** Direct providers for `route`, rebuilt only when its config changes. */
function directProviders(route: DirectRoute): DirectProviders {
  const key = JSON.stringify(route)
  if (directCache?.key === key) return directCache.providers
  const { anthropic, openaiCompatible } = route
  const providers: DirectProviders = {
    ...(anthropic && {
      anthropic: createAnthropic({
        apiKey: anthropic.apiKey,
        ...(anthropic.baseURL && { baseURL: anthropic.baseURL }),
        fetch: plainFetch,
      }),
    }),
    ...(openaiCompatible && {
      openaiCompatible: createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: openaiCompatible.baseURL,
        ...(openaiCompatible.apiKey && { apiKey: openaiCompatible.apiKey }),
        includeUsage: true,
        supportsStructuredOutputs: openaiCompatible.structuredOutputs,
        fetch: plainFetch,
      }),
    }),
  }
  directCache = { key, providers }
  return providers
}

function providerFor<K extends keyof DirectProviders>(
  providers: DirectProviders,
  name: K,
  target: DirectModelTarget
): NonNullable<DirectProviders[K]> {
  const provider = providers[name]
  if (!provider) {
    throw new AiModelUnavailableError(
      target.modelId,
      `${name} is not configured`
    )
  }
  return provider as NonNullable<DirectProviders[K]>
}

function languageModel(modelId: string): LanguageModel {
  const route = resolveAiRoute()
  if (route.kind === 'gateway') return zdrGateway.languageModel(modelId)
  if (route.kind === 'none') throw new AiNotConfiguredError()
  const target = directLanguageModelTarget(route, modelId)
  const providers = directProviders(route)
  return target.provider === 'anthropic'
    ? providerFor(providers, 'anthropic', target).languageModel(target.modelId)
    : providerFor(providers, 'openaiCompatible', target).chatModel(
        target.modelId
      )
}

function embeddingModel(modelId: string): EmbeddingModel {
  const route = resolveAiRoute()
  if (route.kind === 'gateway') return zdrGateway.embeddingModel(modelId)
  if (route.kind === 'none') throw new AiNotConfiguredError()
  const target = directEmbeddingModelTarget(route, modelId)
  return providerFor(
    directProviders(route),
    'openaiCompatible',
    target
  ).embeddingModel(target.modelId)
}

function imageModel(modelId: string): ImageModel {
  const route = resolveAiRoute()
  if (route.kind === 'gateway') return zdrGateway.imageModel(modelId)
  if (route.kind === 'none') throw new AiNotConfiguredError()
  throw new AiModelUnavailableError(modelId, 'image models need the AI Gateway')
}

export interface RoutedProvider {
  (modelId: string): LanguageModel
  readonly specificationVersion: 'v3'
  languageModel(modelId: string): LanguageModel
  chat(modelId: string): LanguageModel
  embeddingModel(modelId: string): EmbeddingModel
  textEmbeddingModel(modelId: string): EmbeddingModel
  imageModel(modelId: string): ImageModel
}

export const gateway: RoutedProvider = Object.assign(
  (modelId: string) => languageModel(modelId),
  {
    specificationVersion: 'v3' as const,
    languageModel,
    chat: languageModel,
    embeddingModel,
    textEmbeddingModel: embeddingModel,
    imageModel,
  }
)

// LUM-870 — the AI SDK resolves a bare string `model` ('deepseek/…') through
// `globalThis.AI_SDK_DEFAULT_PROVIDER`, falling back to the unwrapped global
// gateway (no ZDR). Installing the router here makes string ids routed (and,
// on the gateway route, ZDR) too.
globalThis.AI_SDK_DEFAULT_PROVIDER = gateway
