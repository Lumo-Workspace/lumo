export type ClaimVerdict =
  | 'FAITHFUL'
  | 'UNDERREPORT'
  | 'OVERSTATED'
  | 'UNJUDGEABLE'

export interface TaskDelivery {
  identifier: string
  shas: string[]
  prNumbers: number[]
  diff: string
  commitSubjects: string[]
  changedFiles: string[]
  additions: number
  deletions: number
}

// Injectable command runner (git/gh) — lets diff-oracle be unit-tested without
// shelling out.
export type CommandRunner = (file: string, args: string[]) => string

export interface ClaimJudgeInput {
  claim: string
  diff: string
  commitSubjects: string[]
  changedFiles: string[]
  criteria: string[]
}

export interface ClaimJudgeResult {
  verdict: ClaimVerdict
  evidence: string[]
  reasoning: string
}

export type ClaimJudge = (input: ClaimJudgeInput) => Promise<ClaimJudgeResult>

export type PrefilterSignal = 'UNDERREPORT_CANDIDATE' | null

export interface ClaimFaithfulnessResult {
  verdict: ClaimVerdict
  evidence: string[]
  reasoning: string
  prefilterSignal: PrefilterSignal
  diffScope: number
}
