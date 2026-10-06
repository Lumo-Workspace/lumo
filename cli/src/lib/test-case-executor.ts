import { sanitizeField } from './sanitize'

/**
 * LUM-1008：一条 run 是谁跑的、从哪跑的。
 *
 * CLI 跑的 run 记下的成员是 token 主人，所以「人手动」还是「agent 代跑」看有
 * 没有来源 session——有就附上它的短 id（`lumo` 的 session 时间线按它查）。
 *
 * - 旧服务端不发 `executedBy` → 空串，什么都不打；
 * - `executedBy: null` → 「runner not recorded」，不是「没人」。
 */
export function formatExecutor(run: {
  executedBy?: unknown
  sourceSessionId?: unknown
}): string {
  if (run.executedBy === undefined) return ''
  const who =
    typeof run.executedBy === 'string' && run.executedBy.trim()
      ? `by ${sanitizeField(run.executedBy.trim())}`
      : 'runner not recorded'
  const session =
    typeof run.sourceSessionId === 'string' && run.sourceSessionId
      ? ` via session ${sanitizeField(run.sourceSessionId.slice(0, 8))}`
      : ''
  return who + session
}
