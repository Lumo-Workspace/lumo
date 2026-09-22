import { apiContext, apiCall } from '../lib/test-case-api'
import { resolveRequiredEnvironment } from '../lib/test-case-verdict'

export interface TestCaseAddOptions {
  title?: string
  setup?: string
  step?: string[]
  verify?: string[]
  expected?: string
  requiresEnv?: string
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
      },
    },
    'test case create'
  )
  if (!r.ok || !r.data) return 1

  console.log(
    `Created ${identifier}/TC${r.data.testCase.number} "${r.data.testCase.title}"  ` +
      `(${steps.length} steps, ${verification.length} verification)`
  )
}
