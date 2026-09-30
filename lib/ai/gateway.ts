import { createGatewayProvider } from '@ai-sdk/gateway'
import { createZdrFetch } from './zdr-fetch'

/**
 * The only AI Gateway provider runtime code may use (LUM-854). Same API as
 * `@ai-sdk/gateway`'s default `gateway` — `gateway(id)` for chat,
 * `gateway.textEmbeddingModel(id)` for embeddings — and the same auth
 * (AI_GATEWAY_API_KEY locally, Vercel OIDC in prod), but every inference
 * request is forced to zero data retention by `createZdrFetch`.
 *
 * Never import `gateway` from `@ai-sdk/gateway` or `ai` (which re-exports the
 * unwrapped one) — and every module that imports an AI SDK model function
 * from `ai` must also carry the bare side-effect import
 * `import '@/lib/ai/gateway'`: a named import the module leaves unused is
 * dropped by the compiler, and then string model ids skip ZDR (LUM-877).
 * `__tests__/lib/ai/zdr-gateway.test.ts` fails the build otherwise.
 */
export const gateway = createGatewayProvider({
  fetch: createZdrFetch((input, init) => fetch(input, init)),
})

// LUM-870 — the AI SDK resolves a bare string `model` ('deepseek/…') through
// `globalThis.AI_SDK_DEFAULT_PROVIDER`, falling back to the unwrapped global
// gateway (no ZDR). Installing the wrapper here makes string ids ZDR too.
globalThis.AI_SDK_DEFAULT_PROVIDER = gateway
