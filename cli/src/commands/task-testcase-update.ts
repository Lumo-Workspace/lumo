import { EXIT_USAGE } from '../lib/exit-codes'
import { apiContext, apiCall } from '../lib/test-case-api'
import { resolveRequiredEnvironment } from '../lib/test-case-verdict'
import { sanitizeField } from '../lib/sanitize'
import type { TestCaseScope } from '../lib/test-case-scope'

export interface TestCaseUpdateOptions {
  title?: string
  setup?: string
  step?: string[]
  verify?: string[]
  expected?: string
  requiresEnv?: string
}

export async function testCaseUpdateInScope(
  scope: TestCaseScope,
  caseRef: string,
  options: TestCaseUpdateOptions
): Promise<number | void> {
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

  if (Object.keys(patch).length === 0) {
    console.error(
      'Error: provide at least one field to update (--title / --setup / --step / --verify / --expected / --requires-env).'
    )
    return EXIT_USAGE
  }

  const ctx = apiContext()
  if (!ctx) return 1

  const r = await apiCall<{ testCase: { number: number; title: string } }>(
    ctx,
    `${scope.basePath}/test-cases/${encodeURIComponent(caseRef)}`,
    { method: 'PATCH', json: patch },
    'test case update'
  )
  if (!r.ok || !r.data) return 1

  console.log(
    `Updated ${scope.label}/TC${r.data.testCase.number} "${sanitizeField(r.data.testCase.title)}" ` +
      `(${Object.keys(patch).join(', ')})`
  )
}
