import { createGatewayProvider } from '@ai-sdk/gateway'
import { createZdrFetch } from './zdr-fetch'

/**
 * The only AI Gateway provider runtime code may use (LUM-854). Same API as
 * `@ai-sdk/gateway`'s default `gateway` — `gateway(id)` for chat,
 * `gateway.textEmbeddingModel(id)` for embeddings — and the same auth
 * (AI_GATEWAY_API_KEY locally, Vercel OIDC in prod), but every inference
 * request is forced to zero data retention by `createZdrFetch`.
 *
 * Never import `gateway` from `@ai-sdk/gateway` directly in lib/ or app/ —
 * `__tests__/lib/ai/zdr-gateway.test.ts` fails the build if you do.
 */
export const gateway = createGatewayProvider({
  fetch: createZdrFetch((input, init) => fetch(input, init)),
})
