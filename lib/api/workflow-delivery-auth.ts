import { NextRequest, NextResponse } from 'next/server'
import { sameSecret } from '@/lib/api/cron-auth'

/**
 * LUM-1031 — the gate on the Workflow SDK's delivery routes when Lumo is
 * self-hosted.
 *
 * `withWorkflow` generates `/.well-known/workflow/v1/{flow,step,webhook/[token]}`
 * and `proxy.ts` makes `/.well-known/(.*)` public. On Vercel that is fine: the
 * Vercel World's queue authenticates its own deliveries. Self-hosted on the
 * Postgres World it is not: the graphile-worker job runner POSTs each job to
 * those routes over loopback HTTP carrying only `x-vqs-*` headers
 * (`@workflow/world-postgres/dist/queue.js:280-300`), and the receiving
 * handler checks only that those headers are present
 * (`@workflow/world-local/dist/queue.js:262-279`). Anyone who can reach the
 * app could otherwise run arbitrary workflow steps.
 *
 * How the worker carries the credential: the delivery base URL is
 * `WORKFLOW_LOCAL_BASE_URL` verbatim when set (`queue.js:188-191`), the route
 * URL keeps its userinfo (`@workflow/utils/dist/workflow-routes.js:14-20`),
 * and the transport hands that URL to `node:http.request`
 * (`@workflow/world/dist/node-http.js:284`), which turns `user:pass@` into
 * `Authorization: Basic …`. So the operator sets
 *
 *     WORKFLOW_SECRET=<random>
 *     WORKFLOW_LOCAL_BASE_URL=http://workflow:<url-encoded WORKFLOW_SECRET>@localhost:3000
 *
 * and this gate compares the Basic password with `WORKFLOW_SECRET` in
 * constant time. No fork, no wrapper World, and the secret never lands in the
 * job table (headers passed to `queue()` would be persisted per job).
 *
 * Fail-closed: when the gate applies and `WORKFLOW_SECRET` is unset or empty,
 * every request is rejected.
 */

const WORKFLOW_ROUTE_PREFIX = '/.well-known/workflow/'

/**
 * Whether the Workflow runtime resolves to the Vercel World. Mirrors
 * `resolveWorkflowTargetWorld` / `isVercelWorldTarget` in
 * `@workflow/utils/dist/world-target.js` (a transitive dependency we do not
 * import directly): an explicit `WORKFLOW_TARGET_WORLD` wins, otherwise a
 * Vercel deployment id selects Vercel.
 */
export function usesVercelWorkflowWorld(env: NodeJS.ProcessEnv): boolean {
  const target =
    env.WORKFLOW_TARGET_WORLD || (env.VERCEL_DEPLOYMENT_ID ? 'vercel' : 'local')
  return target === 'vercel' || target === '@workflow/world-vercel'
}

/**
 * Whether the gate applies. Everything except the Vercel World is gated; the
 * one exemption is `next dev`, where the in-memory Local World delivers with
 * the global `fetch`, which refuses URLs that carry credentials and so cannot
 * present a secret. `next start` / a production build always has
 * `NODE_ENV=production`, so the exemption cannot reach a deployment.
 */
export function workflowGuardApplies(env: NodeJS.ProcessEnv): boolean {
  if (usesVercelWorkflowWorld(env)) return false
  return env.NODE_ENV !== 'development'
}

/**
 * Whether a pathname addresses the workflow routes. Percent-decoded and
 * slash-collapsed first so an encoded spelling (`/.well-known/%77orkflow/…`)
 * cannot slip past a prefix check while still being routed. A pathname that
 * does not decode cleanly is treated as a workflow path (fail closed) when it
 * could be one.
 */
export function isWorkflowRoutePath(pathname: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return pathname.toLowerCase().includes('well-known')
  }
  const normalised = decoded.replace(/\/{2,}/g, '/').toLowerCase()
  return normalised.startsWith(WORKFLOW_ROUTE_PREFIX)
}

/** The password half of an `Authorization: Basic` header, or null. */
function basicPassword(header: string | null): string | null {
  const match = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/)
  if (!match?.[1]) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon === -1 ? null : decoded.slice(colon + 1)
}

/**
 * Returns a 401 response when a workflow-route request must be refused, or
 * `null` when the caller may proceed (not a workflow route, gate does not
 * apply, or the credential matches).
 */
export function requireWorkflowDeliveryAuth(
  req: NextRequest,
  env: NodeJS.ProcessEnv = process.env
): NextResponse | null {
  if (!isWorkflowRoutePath(req.nextUrl.pathname)) return null
  if (!workflowGuardApplies(env)) return null

  const unauthorized = () =>
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const secret = env.WORKFLOW_SECRET
  if (!secret) return unauthorized()
  const given = basicPassword(req.headers.get('authorization'))
  if (given === null || !sameSecret(given, secret)) return unauthorized()
  return null
}
