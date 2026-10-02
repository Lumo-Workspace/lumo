import { compareInferenceToBinding } from '@/lib/attribution/inference-eval'
import type { InferredSegment } from '@/lib/attribution/attribute-turns'

const seg = (taskId: string, fromTurn: number, toTurn: number) =>
  ({
    sessionId: 'root',
    taskId,
    fromTurn,
    toTurn,
    fromAt: new Date(0),
    toAt: null,
    confidence: 'HIGH',
    evidence: [],
  }) as InferredSegment

describe('compareInferenceToBinding', () => {
  it('all turns inside a matching segment are correct', () => {
    expect(
      compareInferenceToBinding({
        boundTaskId: 'A',
        turnCount: 3,
        inferred: [seg('A', 0, 2)],
      })
    ).toEqual({
      turns: 3,
      correct: 3,
      wrong: 0,
      unlabeled: 0,
      sessionVerdict: 'correct',
    })
  })

  it('turns in a segment for another task are wrong', () => {
    const r = compareInferenceToBinding({
      boundTaskId: 'A',
      turnCount: 3,
      inferred: [seg('A', 0, 0), seg('B', 1, 2)],
    })
    expect(r).toMatchObject({ correct: 1, wrong: 2, sessionVerdict: 'wrong' })
  })

  it('turns outside any segment are unlabeled', () => {
    const r = compareInferenceToBinding({
      boundTaskId: 'A',
      turnCount: 4,
      inferred: [seg('A', 3, 3)],
    })
    expect(r).toMatchObject({
      correct: 1,
      unlabeled: 3,
      sessionVerdict: 'unlabeled',
    })
  })

  it('no segments: everything unlabeled', () => {
    expect(
      compareInferenceToBinding({
        boundTaskId: 'A',
        turnCount: 2,
        inferred: [],
      })
    ).toMatchObject({ unlabeled: 2, sessionVerdict: 'unlabeled' })
  })

  it('ties resolve wrong > correct > unlabeled', () => {
    expect(
      compareInferenceToBinding({
        boundTaskId: 'A',
        turnCount: 2,
        inferred: [seg('A', 0, 0), seg('B', 1, 1)],
      }).sessionVerdict
    ).toBe('wrong')
    expect(
      compareInferenceToBinding({
        boundTaskId: 'A',
        turnCount: 2,
        inferred: [seg('A', 0, 0)],
      }).sessionVerdict
    ).toBe('correct')
  })

  it('zero turns is unlabeled', () => {
    expect(
      compareInferenceToBinding({
        boundTaskId: 'A',
        turnCount: 0,
        inferred: [],
      })
    ).toMatchObject({ turns: 0, sessionVerdict: 'unlabeled' })
  })
})
