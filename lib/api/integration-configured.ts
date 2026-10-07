import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import {
  integrationConfigStatus,
  type ConfigurableIntegration,
} from '@/lib/integrations/configured'

/** Error code an API client can branch on (never a 5xx: nothing broke). */
export const INTEGRATION_NOT_CONFIGURED = 'integration_not_configured'

/**
 * LUM-1025 — route guard: `null` when the integration is configured on this
 * deployment, else a 404 naming it. A missing env var is a deployment choice,
 * not a server fault, so it must not surface as a 500.
 */
export function requireIntegrationConfigured(
  id: ConfigurableIntegration,
  env: Record<string, string | undefined> = process.env
): NextResponse | null {
  const status = integrationConfigStatus(id, env)
  if (status.configured) return null
  logger.info(
    `[integrations] ${id} is not configured on this deployment (missing: ${status.missing.join(', ')})`
  )
  return NextResponse.json(
    {
      error: INTEGRATION_NOT_CONFIGURED,
      integration: id,
      message: `${id} is not configured on this deployment`,
    },
    { status: 404 }
  )
}
