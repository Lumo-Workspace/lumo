import type { InferredSegment } from './attribute-turns'

/**
 * LUM-932 P2: pure comparison of the engine's inferred root segments against
 * a session's explicit task binding. Turns are 0..turnCount-1; a turn is
 * covered by a segment when fromTurn <= turn <= toTurn.
 */
export type SessionVerdict = 'correct' | 'wrong' | 'unlabeled'

export interface InferenceComparison {
  turns: number
  correct: number
  wrong: number
  unlabeled: number
  sessionVerdict: SessionVerdict
}

export function compareInferenceToBinding(input: {
  boundTaskId: string
  turnCount: number
  /** Root-session segments only. */
  inferred: InferredSegment[]
}): InferenceComparison {
  const { boundTaskId, inferred } = input
  const turns = Math.max(0, input.turnCount)
  let correct = 0
  let wrong = 0
  let unlabeled = 0
  for (let i = 0; i < turns; i++) {
    const seg = inferred.find(s => s.fromTurn <= i && i <= s.toTurn)
    if (!seg) unlabeled++
    else if (seg.taskId === boundTaskId) correct++
    else wrong++
  }
  // Majority of turns; ties resolve conservatively: wrong > correct > unlabeled.
  if (turns === 0) {
    return { turns, correct, wrong, unlabeled, sessionVerdict: 'unlabeled' }
  }
  let sessionVerdict: SessionVerdict = 'wrong'
  let best = wrong
  if (correct > best) {
    sessionVerdict = 'correct'
    best = correct
  }
  if (unlabeled > best) sessionVerdict = 'unlabeled'
  return { turns, correct, wrong, unlabeled, sessionVerdict }
}
