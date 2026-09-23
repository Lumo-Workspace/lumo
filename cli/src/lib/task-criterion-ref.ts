/**
 * LUM-815: 把 `--criterion <selector>` 解析成任务合同里的一条 criterion id。
 *
 * 取数在这里，匹配规则在纯的 `./criterion-selector`（与 milestone 侧同一份，
 * 一个选择器在两处不该有两种含义）。
 */
import { apiCall, type ApiContext } from './test-case-api'
import { resolveCriterionRef } from './criterion-selector'

interface CriteriaResponse {
  criteria: Array<{ id: string; statement: string }>
}

export type TaskCriterionRefResult =
  | { ok: true; id: string }
  | { ok: false; printed: boolean }

/**
 * `selector` 已由调用方 trim 过且非空。返回 `printed: true` 表示错误已打印,
 * 调用方直接 `return 1`。
 */
export async function resolveTaskCriterion(
  ctx: ApiContext,
  taskIdentifier: string,
  selector: string
): Promise<TaskCriterionRefResult> {
  const r = await apiCall<CriteriaResponse>(
    ctx,
    `/api/tasks/${encodeURIComponent(taskIdentifier)}/criteria`,
    {},
    'acceptance criteria read'
  )
  if (!r.ok || !r.data) return { ok: false, printed: true }

  const resolved = resolveCriterionRef(
    selector,
    r.data.criteria,
    `lumo task criteria list ${taskIdentifier}`
  )
  if (!resolved.ok) {
    console.error(`Error: ${resolved.error}`)
    return { ok: false, printed: true }
  }
  return { ok: true, id: resolved.id }
}
