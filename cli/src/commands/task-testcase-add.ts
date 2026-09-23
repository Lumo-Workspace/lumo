import { apiContext, apiCall } from '../lib/test-case-api'
import { resolveRequiredEnvironment } from '../lib/test-case-verdict'
import { resolveTaskCriterion } from '../lib/task-criterion-ref'

export interface TestCaseAddOptions {
  title?: string
  setup?: string
  step?: string[]
  verify?: string[]
  expected?: string
  requiresEnv?: string
  /** LUM-815: 覆盖哪条验收标准（id 或 >=6 字符前缀）。省略 = 不声明。 */
  criterion?: string
}

interface AddResponse {
  testCase: { id: string; number: number; title: string }
}

export async function taskTestCaseAdd(
  identifier: string | undefined,
  options: TestCaseAddOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task testcase add LUM-42 --title "…" --step "…" --expected "…"'
    )
    return 1
  }
  const title = options.title?.trim()
  const expected = options.expected?.trim()
  const steps = (options.step ?? []).map(s => s.trim()).filter(Boolean)
  const verification = (options.verify ?? []).map(s => s.trim()).filter(Boolean)

  if (!title) {
    console.error('Error: --title is required and cannot be empty.')
    return 1
  }
  if (steps.length === 0) {
    console.error('Error: at least one --step is required.')
    return 1
  }
  if (!expected) {
    console.error('Error: --expected is required and cannot be empty.')
    return 1
  }

  const requiredEnvironment = resolveRequiredEnvironment(options.requiresEnv)
  if (!requiredEnvironment.ok) {
    console.error(`Error: ${requiredEnvironment.error}`)
    return 1
  }

  const ctx = apiContext()
  if (!ctx) return 1

  // LUM-815: 覆盖声明是**可选**的 —— 没给就不去查合同,也不写这个字段。
  let criterionId: string | null = null
  const selector = options.criterion?.trim()
  if (selector) {
    const resolved = await resolveTaskCriterion(ctx, identifier, selector)
    if (!resolved.ok) return 1
    criterionId = resolved.id
  }

  const r = await apiCall<AddResponse>(
    ctx,
    `/api/tasks/${encodeURIComponent(identifier)}/test-cases`,
    {
      method: 'POST',
      json: {
        title,
        setup: options.setup?.trim() || null,
        steps,
        verification,
        expected,
        requiredEnvironment: requiredEnvironment.value ?? null,
        criterionId,
      },
    },
    'test case create'
  )
  if (!r.ok || !r.data) return 1

  console.log(
    `Created ${identifier}/TC${r.data.testCase.number} "${r.data.testCase.title}"  ` +
      `(${steps.length} steps, ${verification.length} verification)`
  )
  if (criterionId) {
    console.log(`  covers criterion ${criterionId}`)
  }
}
