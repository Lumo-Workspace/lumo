import { apiContext, apiCall } from '../lib/test-case-api'
import { splitCaseHandle } from '../lib/test-case-handle'
import { resolveRequiredEnvironment } from '../lib/test-case-verdict'
import { resolveTaskCriterion } from '../lib/task-criterion-ref'

export interface TestCaseUpdateOptions {
  title?: string
  setup?: string
  step?: string[]
  verify?: string[]
  expected?: string
  requiresEnv?: string
  /** LUM-815: 三态 —— 省略 = 不碰；`""` = 解绑；id/前缀 = 改绑。 */
  criterion?: string
}

export async function taskTestCaseUpdate(
  handle: string | undefined,
  options: TestCaseUpdateOptions
): Promise<number | void> {
  if (!handle) {
    console.error(
      'Error: missing <task/case>. Usage: lumo task testcase update LUM-42/TC3 --title "…"'
    )
    return 1
  }
  const split = splitCaseHandle(handle)
  if (!split) {
    console.error(
      `Error: invalid handle "${handle}". Expected <task>/TC<n>, e.g. LUM-42/TC3.`
    )
    return 1
  }

  // --step / --verify 是**整段替换**，不是追加（与 add 的语义一致）。
  const patch: Record<string, unknown> = {}
  if (options.title !== undefined) patch.title = options.title.trim()
  if (options.setup !== undefined) patch.setup = options.setup.trim() || null
  if (options.expected !== undefined) patch.expected = options.expected.trim()
  if (options.step !== undefined && options.step.length > 0) {
    patch.steps = options.step.map(s => s.trim()).filter(Boolean)
  }
  if (options.verify !== undefined && options.verify.length > 0) {
    patch.verification = options.verify.map(s => s.trim()).filter(Boolean)
  }

  // 三态：没给 flag = 不碰库里的值；`none` = 清除；具体值 = 设定。
  const requiredEnvironment = resolveRequiredEnvironment(options.requiresEnv)
  if (!requiredEnvironment.ok) {
    console.error(`Error: ${requiredEnvironment.error}`)
    return 1
  }
  if (requiredEnvironment.value !== undefined) {
    patch.requiredEnvironment = requiredEnvironment.value
  }

  // LUM-815: 覆盖声明也是三态,但解析要联网(前缀要对着合同查),所以留到
  // 拿到 ctx 之后再做 —— 这里只先认它算不算「给了一个字段」。
  const criterionGiven = options.criterion !== undefined

  if (Object.keys(patch).length === 0 && !criterionGiven) {
    console.error(
      'Error: provide at least one field to update (--title / --setup / --step / --verify / --expected / --requires-env / --criterion).'
    )
    return 1
  }

  const ctx = apiContext()
  if (!ctx) return 1

  if (criterionGiven) {
    const selector = options.criterion!.trim()
    if (selector === '') {
      // `--criterion ""` = 解绑。用例本身原样留着。
      patch.criterionId = null
    } else {
      const resolved = await resolveTaskCriterion(ctx, split.task, selector)
      if (!resolved.ok) return 1
      patch.criterionId = resolved.id
    }
  }

  const r = await apiCall<{ testCase: { number: number; title: string } }>(
    ctx,
    `/api/tasks/${encodeURIComponent(split.task)}/test-cases/${encodeURIComponent(split.caseRef)}`,
    { method: 'PATCH', json: patch },
    'test case update'
  )
  if (!r.ok || !r.data) return 1

  console.log(
    `Updated ${split.task}/TC${r.data.testCase.number} "${r.data.testCase.title}" ` +
      `(${Object.keys(patch).join(', ')})`
  )
}
