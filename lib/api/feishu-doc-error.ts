import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

/**
 * LUM-1343: a Feishu doc import / sync error as `{ error, code, objectType? }`
 * JSON. The stable `code` is what the UI maps to a localized message; 500s
 * never leak their message.
 */
export function feishuDocErrorResponse(
  error: unknown,
  route: string
): NextResponse {
  const e = error as {
    status?: unknown
    code?: unknown
    objectType?: unknown
  } | null
  const status = typeof e?.status === 'number' ? e.status : 500
  if (status >= 500) {
    logger.error(`${route} failed`, {
      code: typeof e?.code === 'string' ? e.code : null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return NextResponse.json(
    {
      error:
        status === 500 || !(error instanceof Error)
          ? 'Internal error'
          : error.message,
      ...(typeof e?.code === 'string' ? { code: e.code } : {}),
      ...(typeof e?.objectType === 'string'
        ? { objectType: e.objectType }
        : {}),
    },
    { status }
  )
}
