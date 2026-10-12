import { readCredentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { isMissingPluginRoute } from './plugin-route'
import { sanitizeField } from './sanitize'

/**
 * LUM-801: test case 六条命令共用的取数样板。
 *
 * 抽出来纯粹是因为 6 条命令的 auth / URL 解析 / 错误映射逐字相同；行为与
 * 其它命令（如 task artifact *）保持一致，不引入第二种风格。
 */

export interface ApiContext {
  base: string
  token: string
  workspaceSlug: string
}

/** 返回 null 表示已经打印过错误，调用方直接 `return 1`。 */
export function apiContext(): ApiContext | null {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return null
  }
  return {
    base: trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl)),
    token: creds.token,
    workspaceSlug: creds.workspaceSlug,
  }
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
}

/**
 * 发一次请求并把常见失败映射成人话。成功返回 `{ ok: true, data }`；
 * 失败已打印错误，返回 `{ ok: false }`。
 */
export async function apiCall<T>(
  ctx: ApiContext,
  path: string,
  init: RequestInit & { json?: unknown } = {},
  what = 'request',
  /** LUM-1062: printed when the route itself is missing (plugin not installed). */
  missingRouteMessage?: string
): Promise<ApiResult<T>> {
  const { json, ...rest } = init
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.token}`,
    ...((rest.headers as Record<string, string> | undefined) ?? {}),
  }
  if (json !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${ctx.base}${path}`, {
      ...rest,
      headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${ctx.base} (${msg})`)
    return { ok: false }
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return { ok: false }
  }

  if (missingRouteMessage && isMissingPluginRoute(res)) {
    console.error(missingRouteMessage)
    return { ok: false }
  }

  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null

  if (!res.ok) {
    console.error(
      `Error: ${body?.error ?? `${what} failed (HTTP ${res.status})`}`
    )
    return { ok: false }
  }
  return { ok: true, data: body as T }
}

/** 逐行打印一段带 1-based 编号的步骤。 */
export function printNumbered(items: string[], indent = '  '): void {
  items.forEach((text, i) => {
    console.log(`${indent}${i + 1}. ${sanitizeField(text)}`)
  })
}
