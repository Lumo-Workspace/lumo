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
 * Kept free of runtime dependencies so it is unit-testable without pulling
 * `@ai-sdk/gateway` (and its jest-hostile TransformStream) into scope.
 */

type FetchFn = typeof fetch

export const ZDR_GATEWAY_OPTIONS = { zeroDataRetention: true } as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return `body` (a JSON object string) with gateway ZDR forced on. */
export function withZeroDataRetention(body: string): string {
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
  return JSON.stringify({
    ...parsed,
    providerOptions: {
      ...providerOptions,
      gateway: { ...gatewayOptions, ...ZDR_GATEWAY_OPTIONS },
    },
  })
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
    return inner(input, { ...init, body: withZeroDataRetention(init.body) })
  }
}
