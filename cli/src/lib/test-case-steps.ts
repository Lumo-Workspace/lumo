/**
 * LUM-1011: `lumo task testcase run --step / --step-evidence` 的解析，与
 * `testcase show` 的逐步结果打印。
 *
 * 句法（CLI 表面一律 **1-based**，转 0-based 在这里完成）：
 *   --step s2=pass            步骤 2 通过
 *   --step s1-3=pass          步骤 1 到 3 通过
 *   --step v1=fail@0.3s       复验 1 失败，用时 0.3 秒（也接受 300ms）
 *   --step-evidence s3=shot.png    把这份证据挂到步骤 3 下面（文件或 URL）
 *
 * 没写 --step 的步骤**不会被推定为通过**——网页上它读作「未逐步记录」。
 */

export type StepPhase = 'STEPS' | 'VERIFICATION'

export interface StepSpec {
  phase: StepPhase
  /** 0-based。 */
  index: number
  status: 'PASS' | 'FAIL'
  durationMs: number | null
}

export interface StepEvidenceSpec {
  phase: StepPhase
  index: number
  /** 本地文件路径或 http(s) URL。 */
  target: string
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const REF = /^([sv])(\d+)(?:-(\d+))?$/i

function parseRef(
  raw: string
): Parsed<{ phase: StepPhase; from: number; to: number }> {
  const m = REF.exec(raw.trim())
  if (!m) {
    return {
      ok: false,
      error: `Invalid step "${raw}". Use s<n> for a step or v<n> for a verification check, e.g. s2 or s1-3 (1-based).`,
    }
  }
  const from = Number(m[2])
  const to = m[3] !== undefined ? Number(m[3]) : from
  if (from < 1 || to < from) {
    return {
      ok: false,
      error: `Invalid step range "${raw}". Step numbers are 1-based and a range runs low-high.`,
    }
  }
  return {
    ok: true,
    value: {
      phase: m[1]!.toLowerCase() === 's' ? 'STEPS' : 'VERIFICATION',
      from: from - 1,
      to: to - 1,
    },
  }
}

function parseDuration(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/i.exec(raw.trim())
  if (!m) return null
  const n = Number(m[1])
  return Math.round(m[2]!.toLowerCase() === 's' ? n * 1000 : n)
}

/** `--step` 的全部值 → 逐步结果。同一步写两次是错误（读端没法判哪次算数）。 */
export function parseStepSpecs(
  specs: string[] | undefined
): Parsed<StepSpec[]> {
  const out: StepSpec[] = []
  const seen = new Set<string>()
  for (const spec of specs ?? []) {
    const eq = spec.indexOf('=')
    if (eq < 0) {
      return {
        ok: false,
        error: `Invalid --step "${spec}". Expected <step>=<pass|fail>[@duration], e.g. s2=pass or v1=fail@0.3s.`,
      }
    }
    const ref = parseRef(spec.slice(0, eq))
    if (!ref.ok) return ref
    const [statusRaw, durationRaw] = spec.slice(eq + 1).split('@')
    const status = statusRaw?.trim().toUpperCase()
    if (status !== 'PASS' && status !== 'FAIL') {
      return {
        ok: false,
        error: `Invalid --step "${spec}": the result is pass or fail.`,
      }
    }
    let durationMs: number | null = null
    if (durationRaw !== undefined) {
      durationMs = parseDuration(durationRaw)
      if (durationMs === null) {
        return {
          ok: false,
          error: `Invalid duration in --step "${spec}". Use e.g. @1.2s or @300ms.`,
        }
      }
    }
    if (status === 'FAIL' && ref.value.to !== ref.value.from) {
      return {
        ok: false,
        error: `--step "${spec}": only one step can fail — a run breaks at one place.`,
      }
    }
    for (let i = ref.value.from; i <= ref.value.to; i++) {
      const key = `${ref.value.phase}:${i}`
      if (seen.has(key)) {
        return {
          ok: false,
          error: `--step reports ${ref.value.phase === 'STEPS' ? 's' : 'v'}${i + 1} more than once.`,
        }
      }
      seen.add(key)
      out.push({ phase: ref.value.phase, index: i, status, durationMs })
    }
  }
  if (out.filter(s => s.status === 'FAIL').length > 1) {
    return {
      ok: false,
      error: 'Only one --step can be fail — a run breaks at one place.',
    }
  }
  return { ok: true, value: out }
}

/** `--step-evidence <step>=<file|url>` 的全部值。只接受单步，不接受范围。 */
export function parseStepEvidence(
  specs: string[] | undefined
): Parsed<StepEvidenceSpec[]> {
  const out: StepEvidenceSpec[] = []
  for (const spec of specs ?? []) {
    const eq = spec.indexOf('=')
    const target = eq < 0 ? '' : spec.slice(eq + 1).trim()
    if (eq < 0 || target === '') {
      return {
        ok: false,
        error: `Invalid --step-evidence "${spec}". Expected <step>=<file-or-url>, e.g. s3=shot.png.`,
      }
    }
    const ref = parseRef(spec.slice(0, eq))
    if (!ref.ok) return ref
    if (ref.value.to !== ref.value.from) {
      return {
        ok: false,
        error: `--step-evidence "${spec}" names a range; attach evidence to one step.`,
      }
    }
    out.push({ phase: ref.value.phase, index: ref.value.from, target })
  }
  return { ok: true, value: out }
}

export function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target)
}

function label(phase: StepPhase, index: number): string {
  return `${phase === 'STEPS' ? 'step' : 'verification'} ${index + 1}`
}

/**
 * `testcase show` 里一条 run 的逐步结果行。只打显式上报过的步骤——没上报的
 * 不编一个「pass」出来。旧服务端 / 旧 run 没有这一列时返回空数组。
 */
export function formatStepResultLines(stepResults: unknown): string[] {
  if (!Array.isArray(stepResults)) return []
  const lines: string[] = []
  for (const raw of stepResults) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (r.phase !== 'STEPS' && r.phase !== 'VERIFICATION') continue
    if (typeof r.index !== 'number') continue
    if (r.status !== 'PASS' && r.status !== 'FAIL') continue
    const mark = r.status === 'PASS' ? '✓' : '✗'
    const duration =
      typeof r.durationMs === 'number' ? ` (${r.durationMs}ms)` : ''
    const text = typeof r.text === 'string' && r.text ? `: ${r.text}` : ''
    lines.push(`    ${mark} ${label(r.phase, r.index)}${text}${duration}`)
  }
  return lines
}
