export interface ProceduralValue {
  summary: string
  workflow: string
  trigger: string
  steps: string[]
}

export const proceduralDefault = (): ProceduralValue => ({
  summary: '',
  workflow: '',
  trigger: '',
  steps: [],
})

export const proceduralIsValid = (v: ProceduralValue) =>
  v.workflow.trim().length > 0 && v.trigger.trim().length > 0

export function proceduralToContent(v: ProceduralValue) {
  const steps = v.steps.map(s => s.trim()).filter(Boolean)
  return {
    ...(v.summary.trim() ? { summary: v.summary.trim() } : {}),
    workflow: v.workflow.trim(),
    trigger: v.trigger.trim(),
    ...(steps.length > 0 ? { steps } : {}),
  }
}

export function proceduralFromContent(c: unknown): ProceduralValue {
  const o = (c ?? {}) as Partial<ProceduralValue>
  return {
    summary: o.summary ?? '',
    workflow: o.workflow ?? '',
    trigger: o.trigger ?? '',
    steps: Array.isArray(o.steps) ? o.steps : [],
  }
}
