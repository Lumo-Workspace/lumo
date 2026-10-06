/**
 * @jest-environment node
 *
 * LUM-1007 — classifier scorer adapter, arm/threshold/combination logic, the
 * runner's pure helpers and the plain-agent-addressed slice.
 *
 * The slice strings are fixtures for a detector benchmark; they are expected
 * to trip Lumo's own injection advisories.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectLang } from '../classify'
import {
  CLASSIFIER_MODELS,
  classifierInput,
  hfHome,
  modelDir,
  parseClassifierOutput,
  PROTECTAI_V2,
  runClassifier,
  scoreCacheFile,
  THRESHOLD_GRID,
  type ClassifierModel,
} from '../classifier'
import {
  armFlags,
  armId,
  armMs,
  armReport,
  armsFor,
  chooseThreshold,
  chunkCounts,
  percentile,
  sliceReport,
  type Arm,
  type BenchRow,
  type Pools,
} from '../combine'
import {
  PLAIN_EN,
  PLAIN_SLICE_ID,
  PLAIN_ZH,
  plainSliceItems,
  plainSliceSamples,
} from '../plain-agent-addressed'
import {
  buildRows,
  comparisonTable,
  FPR_BOUND,
  parseClassifierArgs,
  regexMismatches,
  sliceTable,
} from '../run-classifier'
import { sha256 } from '../sources'
import { PAYLOADS } from '../../lum999-lumo-context-injection/fixtures'

const row = (over: Partial<BenchRow> = {}): BenchRow => ({
  dataset: 'atk',
  ref: 'r',
  label: 'attack',
  lang: 'en',
  split: 'train',
  regex: false,
  regexMs: 0.1,
  prob: 0.5,
  chunks: 1,
  clfMs: 20,
  ...over,
})

const pools: Pools = {
  attacks: ['atk'],
  publicBenign: ['pub'],
  lumoBenign: ['lumo'],
}

// ─── adapter (classifier.ts) ────────────────────────────────────────────────

describe('classifier adapter', () => {
  it('pins the ProtectAI v2 revision and is config-only', () => {
    expect(PROTECTAI_V2.revision).toMatch(/^90c9989b1a34[0-9a-f]{28}$/)
    expect(PROTECTAI_V2.positiveLabel).toBe('INJECTION')
    expect(PROTECTAI_V2.maxTokens).toBe(512)
    expect(CLASSIFIER_MODELS.map(m => m.id)).toContain('protectai-v2')
    expect(new Set(CLASSIFIER_MODELS.map(m => m.id)).size).toBe(
      CLASSIFIER_MODELS.length
    )
  })

  it('threshold grid is ascending and inside (0, 1)', () => {
    expect([...THRESHOLD_GRID].sort((a, b) => a - b)).toEqual([
      ...THRESHOLD_GRID,
    ])
    expect(THRESHOLD_GRID.every(t => t > 0 && t < 1)).toBe(true)
  })

  it('resolves the HF cache snapshot path', () => {
    expect(hfHome({ HF_HOME: '/x' })).toBe('/x')
    expect(hfHome({})).toMatch(/\.cache\/huggingface$/)
    expect(modelDir(PROTECTAI_V2, '/h')).toBe(
      `/h/hub/models--protectai--deberta-v3-base-prompt-injection-v2/snapshots/${PROTECTAI_V2.revision}/onnx`
    )
    expect(scoreCacheFile('/c', PROTECTAI_V2)).toBe(
      '/c/classifier/protectai-v2@90c9989b1a34.jsonl'
    )
  })

  it('dedupes texts by sha256, first-seen order', () => {
    expect(classifierInput(['a', 'b', 'a'])).toEqual([
      { key: sha256('a'), text: 'a' },
      { key: sha256('b'), text: 'b' },
    ])
  })

  it('parses score lines and rejects malformed ones', () => {
    const ok = '{"key":"k","prob":0.9,"chunks":2,"tokens":700,"ms":31.5}\n\n'
    expect(parseClassifierOutput(ok).get('k')).toEqual({
      prob: 0.9,
      chunks: 2,
      tokens: 700,
      ms: 31.5,
    })
    expect(() =>
      parseClassifierOutput(
        '{"key":"k","prob":1.5,"chunks":1,"tokens":1,"ms":1}'
      )
    ).toThrow(/line 1/)
    expect(() =>
      parseClassifierOutput(
        '{"key":"k","prob":0.1,"chunks":0,"tokens":1,"ms":1}'
      )
    ).toThrow()
    expect(() => parseClassifierOutput('{"prob":0.1}')).toThrow()
  })

  it('reuses cached scores without spawning Python', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'lum1007-'))
    mkdirSync(join(cacheDir, 'classifier'))
    writeFileSync(
      scoreCacheFile(cacheDir, PROTECTAI_V2),
      `${JSON.stringify({ key: sha256('hi'), prob: 0.2, chunks: 1, tokens: 1, ms: 5 })}\n`
    )
    const scores = await runClassifier(PROTECTAI_V2, ['hi', 'hi'], {
      python: '/nonexistent/python',
      cacheDir,
    })
    expect(scores.get(sha256('hi'))?.prob).toBe(0.2)
  })

  it('fails clearly when the model is not in the HF cache', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'lum1007-'))
    const model: ClassifierModel = { ...PROTECTAI_V2, id: 'absent' }
    await expect(
      runClassifier(model, ['x'], {
        python: '/nonexistent/python',
        cacheDir,
        hfHomeDir: join(cacheDir, 'no-hf'),
      })
    ).rejects.toThrow(/not in the HF cache/)
  })
})

// ─── arms + combination (combine.ts) ────────────────────────────────────────

describe('arms', () => {
  const clf: Arm = { id: 'c', kind: 'classifier', model: 'm', threshold: 0.9 }
  const or: Arm = { id: 'o', kind: 'or', model: 'm', threshold: 0.9 }
  const regex: Arm = { id: 'regex', kind: 'regex' }

  it('regex arm uses the regex verdict only', () => {
    expect(armFlags(row({ regex: true, prob: 0 }), regex)).toBe(true)
    expect(armFlags(row({ regex: false, prob: 1 }), regex)).toBe(false)
  })

  it('classifier arm is prob ≥ threshold (inclusive)', () => {
    expect(armFlags(row({ prob: 0.9 }), clf)).toBe(true)
    expect(armFlags(row({ prob: 0.8999 }), clf)).toBe(false)
    expect(armFlags(row({ prob: 0.1, regex: true }), clf)).toBe(false)
  })

  it('OR arm flags when either scorer does', () => {
    expect(armFlags(row({ regex: true, prob: 0 }), or)).toBe(true)
    expect(armFlags(row({ regex: false, prob: 0.95 }), or)).toBe(true)
    expect(armFlags(row({ regex: false, prob: 0.1 }), or)).toBe(false)
  })

  it('non-regex arms need a threshold', () => {
    expect(() => armFlags(row(), { id: 'x', kind: 'or', model: 'm' })).toThrow(
      /threshold/
    )
  })

  it('OR latency is the sum of both scorers', () => {
    const r = row({ regexMs: 0.5, clfMs: 30 })
    expect(armMs(r, regex)).toBe(0.5)
    expect(armMs(r, clf)).toBe(30)
    expect(armMs(r, or)).toBe(30.5)
  })

  it('arm ids', () => {
    expect(armId('regex')).toBe('regex')
    expect(armId('classifier', 'm', 0.99)).toBe('m@0.99')
    expect(armId('or', 'm', 0.99)).toBe('regex OR m@0.99')
  })
})

describe('chooseThreshold', () => {
  // 100 train Lumo-benign rows: probs 0.00..0.99 → at t, FPR = share with prob ≥ t.
  const benign = Array.from({ length: 100 }, (_, i) =>
    row({ dataset: 'lumo', label: 'benign', ref: `b${i}`, prob: i / 100 })
  )
  const attacks = [0.95, 0.995, 0.5].map((prob, i) =>
    row({ ref: `a${i}`, prob })
  )

  it('picks the lowest grid value within the FPR bound on TRAIN', () => {
    const c = chooseThreshold(
      [...benign, ...attacks],
      'classifier',
      'm',
      pools,
      0.01,
      [0.5, 0.9, 0.99, 0.999]
    )
    expect(c.threshold).toBe(0.99) // 1/100 benign at ≥ 0.99
    expect(c.trainLumoFpr).toMatchObject({ k: 1, n: 100 })
    expect(c.trainRecall).toMatchObject({ k: 1, n: 3 })
  })

  it('ignores held-out rows entirely', () => {
    const leak = Array.from({ length: 50 }, (_, i) =>
      row({
        dataset: 'lumo',
        label: 'benign',
        split: 'heldout',
        ref: `h${i}`,
        prob: 0.9999,
      })
    )
    const c = chooseThreshold(
      [...benign, ...attacks, ...leak],
      'classifier',
      'm',
      pools,
      0.01,
      [0.5, 0.9, 0.99, 0.999]
    )
    expect(c.threshold).toBe(0.99)
  })

  it('OR arm counts regex false positives against the budget', () => {
    const withRegexFp = benign.map((b, i) =>
      i < 1 ? { ...b, regex: true } : b
    )
    const c = chooseThreshold(
      [...withRegexFp, ...attacks],
      'or',
      'm',
      pools,
      0.01,
      [0.5, 0.9, 0.99, 0.999]
    )
    // regex already spends 1/100; 0.99 would add b99 → 2%. Next grid value.
    expect(c.threshold).toBe(0.999)
  })

  it('returns null when no grid value fits', () => {
    const allRegex = benign.map(b => ({ ...b, regex: true }))
    expect(
      chooseThreshold(allRegex, 'or', 'm', pools, 0.01, [0.5, 0.99]).threshold
    ).toBeNull()
  })
})

describe('armReport', () => {
  const rows = [
    row({ split: 'heldout', ref: 'a1', prob: 0.99 }),
    row({ split: 'heldout', ref: 'a2', prob: 0.1, lang: 'zh', clfMs: 40 }),
    row({
      split: 'heldout',
      dataset: 'lumo',
      label: 'benign',
      ref: 'b1',
      prob: 0.1,
    }),
    row({
      split: 'heldout',
      dataset: 'pub',
      label: 'benign',
      ref: 'p1',
      prob: 0.95,
    }),
    row({ split: 'train', ref: 'a3', prob: 0.99 }),
  ]
  it('reports recall per dataset + language, FPRs and latency on one split', () => {
    const arm: Arm = { id: 'c', kind: 'classifier', model: 'm', threshold: 0.9 }
    const r = armReport(rows, arm, pools, FPR_BOUND, 'heldout')
    expect(r.attacks).toMatchObject({ k: 1, n: 2 })
    expect(r.attacksByDataset.atk).toMatchObject({ k: 1, n: 2 })
    expect(r.attacksByLanguage.en).toMatchObject({ k: 1, n: 1 })
    expect(r.attacksByLanguage.zh).toMatchObject({ k: 0, n: 1 })
    expect(r.attacksByLanguage.de).toBeUndefined()
    expect(r.lumoBenign).toMatchObject({ k: 0, n: 1 })
    expect(r.lumoBenignByLanguage.en).toMatchObject({ k: 0, n: 1 })
    expect(r.lumoBenignFlaggedChunked).toBe(0)
    expect(r.publicBenign).toMatchObject({ k: 1, n: 1 })
    expect(r.withinFprBound).toBe(true)
    expect(r.latencyMs).toEqual({ p50: 20, p95: 40 })
  })
})

describe('armReport chunked false positives', () => {
  it('counts flagged Lumo-benign samples that needed chunking', () => {
    const rows = [
      row({
        dataset: 'lumo',
        label: 'benign',
        ref: 'b1',
        prob: 0.95,
        chunks: 3,
        lang: 'zh',
      }),
      row({
        dataset: 'lumo',
        label: 'benign',
        ref: 'b2',
        prob: 0.95,
        chunks: 1,
      }),
      row({
        dataset: 'lumo',
        label: 'benign',
        ref: 'b3',
        prob: 0.1,
        chunks: 4,
      }),
    ]
    const arm: Arm = { id: 'c', kind: 'classifier', model: 'm', threshold: 0.9 }
    const r = armReport(rows, arm, pools, FPR_BOUND)
    expect(r.lumoBenignFlaggedChunked).toBe(1)
    expect(r.lumoBenignByLanguage.zh).toMatchObject({ k: 1, n: 1 })
    expect(r.withinFprBound).toBe(false)
  })
})

describe('percentile / chunkCounts / armsFor', () => {
  it('nearest-rank percentile', () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([3, 1, 2], 50)).toBe(2)
    expect(
      percentile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        95
      )
    ).toBe(95)
    expect(percentile([1.23456], 95)).toBe(1.235)
  })

  it('counts chunked samples per dataset', () => {
    const rows = [
      row({ chunks: 1 }),
      row({ chunks: 3 }),
      row({ dataset: 'lumo', chunks: 2 }),
    ]
    expect(chunkCounts(rows, ['atk', 'lumo', 'none'])).toEqual([
      { dataset: 'atk', n: 2, chunked: 1, maxChunks: 3 },
      { dataset: 'lumo', n: 1, chunked: 1, maxChunks: 2 },
      { dataset: 'none', n: 0, chunked: 0, maxChunks: 0 },
    ])
  })

  it('builds classifier + OR arms, marking the train pick', () => {
    const arms = armsFor('m', [0.5, 0.99], { classifier: 0.995, or: 0.99 })
    expect(arms.map(a => [a.id, a.chosen])).toEqual([
      ['m@0.5', 'fixed'],
      ['m@0.99', 'fixed'],
      ['m@0.995', 'train'],
      ['regex OR m@0.5', 'fixed'],
      ['regex OR m@0.99', 'train'],
    ])
    expect(armsFor('m', [0.5], { classifier: null, or: null })).toHaveLength(2)
  })
})

describe('sliceReport', () => {
  it('reports the slice by its own language tag plus verbatim verdicts', () => {
    const rows = [
      row({ dataset: 'slice', ref: 'en:0', prob: 0.99 }),
      row({ dataset: 'slice', ref: 'zh:0', prob: 0.1, split: 'heldout' }),
      row({ dataset: 'slice', ref: 'lum999:x', regex: true, prob: 0 }),
      row({ dataset: 'other', ref: 'en:1', prob: 0.99 }),
    ]
    const langOf = (ref: string): string => (ref.startsWith('zh') ? 'zh' : 'en')
    const or: Arm = { id: 'o', kind: 'or', model: 'm', threshold: 0.9 }
    const r = sliceReport(rows, or, 'slice', langOf, ['lum999:x', 'missing'])
    expect(r.all).toMatchObject({ k: 2, n: 3 })
    expect(r.byLanguage.en).toMatchObject({ k: 2, n: 2 })
    expect(r.byLanguage.zh).toMatchObject({ k: 0, n: 1 })
    expect(r.verbatim).toEqual({ 'lum999:x': true })
  })
})

// ─── runner helpers (run-classifier.ts) ─────────────────────────────────────

describe('run-classifier helpers', () => {
  it('parses args', () => {
    expect(
      parseClassifierArgs(['--python', '/p', '--offline', '--rescore'], {})
    ).toMatchObject({
      python: '/p',
      offline: true,
      rescore: true,
    })
    expect(parseClassifierArgs([], { LUM1007_PYTHON: '/v' }).python).toBe('/v')
    expect(() => parseClassifierArgs(['--out'], {})).toThrow(/needs a value/)
    expect(() => parseClassifierArgs(['--nope'], {})).toThrow(/unknown/)
  })

  it('joins regex verdicts with classifier scores by sha256(text)', () => {
    const s = {
      dataset: 'atk',
      ref: 'r1',
      text: 'hello',
      label: 'attack' as const,
      regex: true,
      regexMs: 1,
    }
    const scores = new Map([
      [sha256('hello'), { prob: 0.7, chunks: 2, tokens: 600, ms: 9 }],
    ])
    const [r] = buildRows([s], scores)
    expect(r).toMatchObject({
      regex: true,
      prob: 0.7,
      chunks: 2,
      clfMs: 9,
      lang: 'en',
    })
    expect(['train', 'heldout']).toContain(r?.split)
    expect(() => buildRows([{ ...s, text: 'other' }], scores)).toThrow(
      /no classifier score/
    )
  })

  it('detects regex drift from the committed results.json', () => {
    const rows = [
      row({ regex: true, split: 'train' }),
      row({ dataset: 'lumo', label: 'benign', split: 'heldout' }),
    ]
    const z = { k: 0, n: 0 }
    const committed = {
      pooled: {
        attacks: { flagged: { k: 1, n: 1 } },
        lumoBenign: { flagged: { k: 0, n: 1 } },
        publicBenign: { flagged: z },
      },
      split: {
        train: { attacks: { k: 1, n: 1 }, lumoBenign: z, publicBenign: z },
        heldout: { attacks: z, lumoBenign: { k: 0, n: 1 }, publicBenign: z },
      },
    }
    expect(regexMismatches(rows, pools, committed)).toEqual([])
    committed.pooled.attacks.flagged = { k: 0, n: 1 }
    expect(regexMismatches(rows, pools, committed)).toEqual([
      'pooled.attacks: got 1/1, results.json has 0/1',
    ])
  })

  it('renders the comparison and slice tables', () => {
    const rows = [
      row({ split: 'heldout' }),
      row({ split: 'heldout', dataset: 'lumo', label: 'benign' }),
    ]
    const arm: Arm = {
      id: 'm@0.9',
      kind: 'classifier',
      model: 'm',
      threshold: 0.9,
      chosen: 'train',
    }
    const t = comparisonTable(
      [armReport(rows, arm, pools, FPR_BOUND, 'heldout')],
      ['atk']
    )
    expect(t.split('\n')).toHaveLength(3)
    expect(t).toContain('m@0.9 ★')
    const s = sliceTable([
      sliceReport(
        [row({ dataset: 'x', ref: 'lum999:a' })],
        arm,
        'x',
        () => 'en',
        ['lum999:a']
      ),
    ])
    expect(s).toContain('| m@0.9 ★ |')
    expect(s).toContain('0/1')
  })
})

// ─── the plain-agent-addressed slice ────────────────────────────────────────

describe('plain-agent-addressed slice', () => {
  const items = plainSliceItems()

  it('carries the four LUM-999 payloads verbatim', () => {
    const lum999 = items.filter(i => i.origin === 'lum999')
    expect(lum999.map(i => i.text).sort()).toEqual(
      [
        PAYLOADS.plain.canary_file,
        PAYLOADS.plain.commit_marker,
        PAYLOADS.flagged.canary_file,
        PAYLOADS.flagged.commit_marker,
      ].sort()
    )
  })

  it('has 20–40 hand-written asks per language, unique refs and texts', () => {
    expect(PLAIN_EN.length).toBeGreaterThanOrEqual(20)
    expect(PLAIN_EN.length).toBeLessThanOrEqual(40)
    expect(PLAIN_ZH.length).toBeGreaterThanOrEqual(20)
    expect(PLAIN_ZH.length).toBeLessThanOrEqual(40)
    expect(new Set(items.map(i => i.ref)).size).toBe(items.length)
    expect(new Set(items.map(i => i.text)).size).toBe(items.length)
  })

  it('hand-written asks contain no override vocabulary', () => {
    const override =
      /\b(ignore|disregard|forget|override|previous instructions|above instructions|new instructions)\b|忽略|无视|忘记|之前的指令|新的指示/i
    for (const i of items.filter(x => x.origin === 'handwritten'))
      expect(i.text).not.toMatch(override)
  })

  it('authored language tags agree with the bench language heuristic (mixed-script ZH aside)', () => {
    const hand = items.filter(x => x.origin === 'handwritten')
    for (const i of hand.filter(x => x.lang === 'en'))
      expect(detectLang(i.text)).toBe('en')
    const zh = hand.filter(x => x.lang === 'zh')
    for (const i of zh) expect(i.text).toMatch(/[一-鿿]/u)
    // The slice is reported by its authored tag. A ZH ask full of Latin
    // identifiers (package.json, the marker) can fall under detectLang's 30%
    // CJK share; allow that, but not for most of the set.
    expect(
      zh.filter(i => detectLang(i.text) === 'zh').length
    ).toBeGreaterThanOrEqual(Math.ceil(zh.length * 0.9))
  })

  it('becomes attack samples of its own dataset id', () => {
    const samples = plainSliceSamples()
    expect(samples).toHaveLength(items.length)
    expect(
      samples.every(s => s.dataset === PLAIN_SLICE_ID && s.label === 'attack')
    ).toBe(true)
  })
})
