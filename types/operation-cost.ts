export interface OperationCostRowDto {
  key: string
  label: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  /** LUM-840: per-command rows under a `Bash · <purpose>` tool row (sums to it). */
  breakdown?: OperationCostRowDto[]
}

export interface OperationCostResponse {
  version: 1
  scope: { kind: 'task' | 'session' | 'workspace'; label: string }
  grandTotal: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    total: number
  }
  coverage: {
    toolTurns: number
    perStepTurns: number
    /** perStepTurns / toolTurns; null when no tool turns. */
    perStepPct: number | null
  }
  byTool: OperationCostRowDto[]
  byModel: OperationCostRowDto[]
  byMember: OperationCostRowDto[]
  bySession: OperationCostRowDto[]
}
