/**
 * The outcome well's verdict space (LUM-598), extracted so DB-free modules (the
 * LUM-601 git-referent detector) can share the exact same constant without
 * pulling the repository/Prisma layer into their module graph.
 *
 * INVARIANT — falsifier, not verifier. The space has exactly two members and
 * there is deliberately no 'SATISFIED'/'PASS': the absence of a rejection signal
 * (INCONCLUSIVE) is externally indistinguishable between genuinely-good, merely-
 * tolerated, and never-noticed, so it is never upgraded to a pass.
 */
export const OUTCOME_VERDICTS = ['REJECTED', 'INCONCLUSIVE'] as const
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number]
