/**
 * LUM-1311 — which test-case runs reach the issue assessment's judge when a
 * task has more cases than fit. Before, cases were read in number order and
 * cut at 12 / 5,000 chars, so a task's last cases (often the screenshot and
 * full-suite runs) were never evidence. Now each requirement's best-fitting
 * PASS run is offered to the cap first, and lines go compact to fit more.
 */
import {
  capScreenshotAnswers,
  EVIDENCE_MATERIAL_MAX,
  rankEvidenceCases,
  testCaseEvidenceAtHead,
  testCaseEvidenceMaterial,
  type StoredEvidenceCase,
  type StoredEvidenceRun,
} from '@/ee/security/security-scan/test-case-evidence'
import { requirementsMaterial } from '@/ee/security/security-scan/issue-assessment'

const HEAD = '8b286d64d95f06528cf0a57cf33719072f2423d3'

const longSteps = Array.from({ length: 8 }, (_, i) => ({
  phase: 'STEPS',
  index: i,
  text: `run: npx jest __tests__/ee/security/components/part-${i}.test.tsx `.padEnd(
    119,
    'x'
  ),
  status: 'PASS',
}))

function run(over: Partial<StoredEvidenceRun> = {}): StoredEvidenceRun {
  return {
    result: 'PASS',
    environment: 'LOCAL',
    commitSha: HEAD,
    commitDirty: false,
    stepResults: longSteps,
    evidence: [{ type: 'file', filename: 'jest-summary.json' }],
    unprovenVerification: [],
    ...over,
  }
}

function tc(
  number: number,
  runs: StoredEvidenceRun[],
  over: Partial<StoredEvidenceCase> = {}
): StoredEvidenceCase {
  return {
    number,
    title: `Component case ${number}: rows, folds and badges render`,
    expected: 'e'.repeat(119),
    requiredEnvironment: null,
    runs,
    ...over,
  }
}

/** LUM-1308's shape: 12 unit-test cases, then the browser and full-suite runs last. */
function manyCases(): StoredEvidenceCase[] {
  return [
    ...Array.from({ length: 12 }, (_, i) => tc(i + 1, [run()])),
    tc(
      13,
      [
        run({
          stepResults: [
            {
              phase: 'STEPS',
              index: 0,
              text: 'open: the Record tab at 640px in a real browser',
              status: 'PASS',
            },
          ],
          evidence: [{ type: 'file', filename: 'record-640-light.png' }],
        }),
      ],
      { title: 'Real browser at Record tab width', expected: 'No overflow.' }
    ),
    tc(
      14,
      [
        run({
          stepResults: [
            {
              phase: 'STEPS',
              index: 0,
              text: 'run: npx tsc --noEmit',
              status: 'PASS',
            },
            {
              phase: 'STEPS',
              index: 1,
              text: 'run: npx jest (whole suite)',
              status: 'PASS',
            },
          ],
          evidence: [{ type: 'file', filename: 'tsc.log' }],
        }),
      ],
      { title: 'Full suite: tsc and jest exit 0', expected: 'Both exit 0.' }
    ),
  ]
}

const REQS = [
  {
    id: 'task:done:1',
    text: 'Record tab renders the states; screenshot at ~640px width from a real browser on the PR.',
  },
  { id: 'task:done:2', text: '`npx tsc --noEmit` and `npx jest` exit 0.' },
]

describe('LUM-1311: the runs that can prove a requirement reach the judge', () => {
  it('a screenshot case numbered last, past 12 long cases, is shown and judged from', () => {
    const e = testCaseEvidenceAtHead(manyCases(), HEAD)
    expect(e.notRead).toEqual([])
    const text = testCaseEvidenceMaterial(
      e,
      REQS.map(r => r.text)
    )!
    const lines = text.split('\n')
    expect(lines.some(l => l.startsWith('- TC13 "Real browser'))).toBe(true)
    expect(lines.some(l => l.startsWith('- TC14 "Full suite'))).toBe(true)
    // Some low-fit cases had to give way, and they are named.
    expect(lines.pop()).toMatch(
      /^Not shown \(length or case limit\), so not evidence here: TC\d+(, TC\d+)*\.$/
    )
    expect(text.length).toBeLessThanOrEqual(EVIDENCE_MATERIAL_MAX)
    // The rule Lumo enforces lets the model's answer stand: the image run counts.
    const answers = [
      { id: 'task:done:1', outcome: 'addressed', explanation: 'TC13.' },
    ]
    expect(capScreenshotAnswers(REQS, answers, e)).toEqual(answers)
  })

  it('rides through the requirements material with the requirements as the ranking', () => {
    const material = requirementsMaterial(
      REQS.map(r => ({
        ...r,
        source: 'task' as const,
        label: 'LUM-1 · Requirement',
        quotable: true,
      })),
      {
        decisions: [],
        mergedPrCount: 0,
        mergedPrs: [],
        testCases: testCaseEvidenceAtHead(manyCases(), HEAD),
      }
    )
    expect(material).toContain('- TC13 "Real browser at Record tab width"')
    expect(material).toContain('- TC14 "Full suite: tsc and jest exit 0"')
  })

  it("each requirement's best fit goes first, in requirement order; then PASS by fit; other results last", () => {
    const cases = [
      tc(1, [run({ result: 'FAIL' })], { title: 'jest tsc exit screenshot' }),
      ...manyCases().slice(1),
    ]
    const ranked = rankEvidenceCases(
      testCaseEvidenceAtHead(cases, HEAD).atHead,
      REQS.map(r => r.text)
    ).map(e => e.number)
    expect(ranked.slice(0, 2)).toEqual([13, 14])
    expect(ranked[ranked.length - 1]).toBe(1)
  })

  it('without requirements: PASS first, then number order', () => {
    const e = testCaseEvidenceAtHead(
      [tc(1, [run({ result: 'BLOCKED' })]), tc(2, [run()]), tc(3, [run()])],
      HEAD
    )
    expect(rankEvidenceCases(e.atHead).map(x => x.number)).toEqual([2, 3, 1])
  })

  it('lines go compact before a case is left out, and are listed in number order', () => {
    const text = testCaseEvidenceMaterial(
      testCaseEvidenceAtHead(manyCases(), HEAD),
      REQS.map(r => r.text)
    )!
    const caseLines = text.split('\n').filter(l => l.startsWith('- TC'))
    // Whole compact lines: steps beyond the compact limit are counted, not cut mid-line.
    expect(caseLines.some(l => l.includes('(+4 more)'))).toBe(true)
    for (const l of caseLines) expect(l).toMatch(/\.$/)
    const numbers = caseLines.map(l => Number(/^- TC(\d+)/.exec(l)![1]))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    // More cases fit than the old full-line-only cut (5 of these long ones).
    expect(caseLines.length).toBeGreaterThan(5)
  })

  it('a few short cases all keep their full lines', () => {
    const text = testCaseEvidenceMaterial(
      testCaseEvidenceAtHead([tc(1, [run()]), tc(2, [run()])], HEAD),
      REQS.map(r => r.text)
    )!
    expect(text).not.toContain('more)')
    expect(text).not.toContain('Not shown')
  })

  it('room for the "Not shown" line is kept only when a case is left out', () => {
    let usedReservedRoom = false
    for (let n = 1; n <= 30; n++) {
      const cases = Array.from({ length: n }, (_, i) =>
        tc(i + 1, [run({ stepResults: longSteps.slice(0, 2) })])
      )
      const text = testCaseEvidenceMaterial(
        testCaseEvidenceAtHead(cases, HEAD)
      )!
      expect(text.length).toBeLessThanOrEqual(EVIDENCE_MATERIAL_MAX)
      const reserve =
        1 +
        `Not shown (length or case limit), so not evidence here: ${cases.map(c => `TC${c.number}`).join(', ')}.`
          .length
      if (
        !text.includes('Not shown') &&
        text.length > EVIDENCE_MATERIAL_MAX - reserve
      )
        usedReservedRoom = true
    }
    // Some count of cases fits only because nothing was held back for that line.
    expect(usedReservedRoom).toBe(true)
  })
})
