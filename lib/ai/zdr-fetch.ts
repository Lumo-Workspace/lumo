/**
 * Zero-data-retention enforcement at the wire (LUM-854).
 *
 * Every AI Gateway inference request (chat + embedding) is a JSON POST whose
 * body carries the call's `providerOptions` at the top level. This fetch
 * wrapper rewrites that body so `providerOptions.gateway.zeroDataRetention`
 * is always `true` — the gateway then routes only to providers with a ZDR
 * agreement (e.g. DeepSeek/GLM go to Alibaba/Baseten, never the first-party
 * deepseek/zai endpoints) and fails with `no_providers_available` rather than
 * silently falling back to a retaining provider.
 *
 * Forced, not defaulted: a call site passing `zeroDataRetention: false` is
 * overridden; other call-site gateway options (order/only/…) are kept.
 * Fail closed: a POST whose body we cannot read as a JSON object throws
 * instead of being sent unconstrained. Non-POST requests (the gateway's
 * model-metadata GETs) carry no customer data and pass through untouched.
 *
 * LUM-988 — the same wire also pins a model to the hosts on Lumo's published
 * subprocessor list: when the request's model-id header (`ai-language-model-id`
 * for chat, `ai-model-id` for every other model kind) names a model in
 * `MODEL_PROVIDER_PINS`, `providerOptions.gateway.only` is forced to that
 * list, so a call site cannot route customer code to a host that was never
 * announced. Fail closed here too: every inference POST the gateway SDK sends
 * names its model in one of those headers, so a POST that names none is
 * refused — otherwise a pinned model would leave with ZDR but no `only`.
 *
 * Kept free of runtime dependencies so it is unit-testable without pulling
 * `@ai-sdk/gateway` (and its jest-hostile TransformStream) into scope.
 */

import { MODEL_PROVIDER_PINS } from './models'

type FetchFn = typeof fetch

/** The gateway's headers naming the model: chat, then every other kind. */
const MODEL_ID_HEADERS = ['ai-language-model-id', 'ai-model-id'] as const

export const ZDR_GATEWAY_OPTIONS = { zeroDataRetention: true } as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Return `body` (a JSON object string) with gateway ZDR forced on, and — when
 * `modelId` is pinned in `MODEL_PROVIDER_PINS` — `only` forced to its hosts.
 */
export function withZeroDataRetention(
  body: string,
  modelId?: string | null
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(
      'ZDR guard: refusing to send a non-JSON AI Gateway request body'
    )
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      'ZDR guard: refusing to send a non-object AI Gateway request body'
    )
  }
  const providerOptions = isPlainObject(parsed.providerOptions)
    ? parsed.providerOptions
    : {}
  const gatewayOptions = isPlainObject(providerOptions.gateway)
    ? providerOptions.gateway
    : {}
  const pin = modelId ? MODEL_PROVIDER_PINS[modelId] : undefined
  return JSON.stringify({
    ...parsed,
    providerOptions: {
      ...providerOptions,
      gateway: {
        ...gatewayOptions,
        ...ZDR_GATEWAY_OPTIONS,
        ...(pin ? { only: [...pin] } : {}),
      },
    },
  })
}

/** The model the request names, from `init.headers` or the `Request` itself. */
export function modelIdOf(
  input: Parameters<FetchFn>[0],
  init?: RequestInit
): string | null {
  const sources = [
    init?.headers ? new Headers(init.headers) : null,
    typeof Request !== 'undefined' && input instanceof Request
      ? input.headers
      : null,
  ]
  for (const headers of sources) {
    for (const name of MODEL_ID_HEADERS) {
      const id = headers?.get(name)
      if (id) return id
    }
  }
  return null
}

function methodOf(input: Parameters<FetchFn>[0], init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request)
    return input.method.toUpperCase()
  return 'GET'
}

/** Wrap `inner` so every POST body sent through it has gateway ZDR forced on. */
export function createZdrFetch(inner: FetchFn): FetchFn {
  return async (input, init) => {
    if (methodOf(input, init) !== 'POST') return inner(input, init)
    if (typeof init?.body !== 'string') {
      throw new Error(
        'ZDR guard: refusing to send an AI Gateway POST without a JSON string body'
      )
    }
    const modelId = modelIdOf(input, init)
    if (!modelId) {
      throw new Error(
        'ZDR guard: refusing to send an AI Gateway POST that names no model (ai-language-model-id / ai-model-id)'
      )
    }
    return inner(input, {
      ...init,
      body: withZeroDataRetention(init.body, modelId),
    })
  }
}
