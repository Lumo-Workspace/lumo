/**
 * LUM-1007 — second scorer for the LUM-996 bench: a local ML classifier.
 *
 * `score.ts` is the regex detector (production code, unchanged). This module
 * is the adapter for a Hugging Face sequence classifier exported to ONNX and
 * run on CPU by `classifier/score_onnx.py` in an isolated Python venv — no
 * npm dependency, no network at scoring time (the model is read from the
 * local HF cache, and the subprocess runs with HF_HUB_OFFLINE=1).
 *
 * A model is pure config (`ClassifierModel`): adding another one — e.g.
 * Prompt Guard 2 once its gated access is granted — means appending an entry
 * to CLASSIFIER_MODELS, nothing else. See the README "TODO: Prompt Guard 2".
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { sha256 } from './sources'

export interface ClassifierModel {
  /** Short arm id used in results (e.g. `protectai-v2`). */
  id: string
  /** Hugging Face repo id. */
  repo: string
  /** Pinned HF commit sha — the snapshot directory name in the HF cache. */
  revision: string
  /** Sub-folder of the snapshot holding model.onnx + tokenizer.json + config.json. */
  onnxSubdir: string
  /** id2label value of the "this is an injection" class. */
  positiveLabel: string
  /** Model window in tokens, including [CLS]/[SEP]. Longer texts are chunked. */
  maxTokens: number
  licence: string
  gated: boolean
  /** Fixed thresholds reported alongside the train-chosen one. */
  reportThresholds: number[]
}

export const PROTECTAI_V2: ClassifierModel = {
  id: 'protectai-v2',
  repo: 'protectai/deberta-v3-base-prompt-injection-v2',
  revision: '90c9989b1a342275dd0d1a95aad283c04e075671',
  onnxSubdir: 'onnx',
  positiveLabel: 'INJECTION',
  maxTokens: 512,
  licence: 'Apache-2.0',
  gated: false,
  reportThresholds: [0.5, 0.9, 0.99, 0.999],
}

/**
 * Models the bench runs. TODO(LUM-1007, PG2): once Meta grants access to
 * meta-llama/Llama-Prompt-Guard-2-86M / -22M, export them to ONNX (or add a
 * safetensors runtime to score_onnx.py), pin their revisions and append
 * entries here (positiveLabel per their config.json id2label).
 */
export const CLASSIFIER_MODELS: readonly ClassifierModel[] = [PROTECTAI_V2]

/** Candidate thresholds the train split chooses from (ascending). */
export const THRESHOLD_GRID: readonly number[] = [
  0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.999, 0.9995, 0.9999,
  0.99995, 0.99999, 0.999995, 0.999999, 0.9999995, 0.9999999, 0.99999995,
]

export interface ClassifierScore {
  /** Positive-class probability, max over chunks. */
  prob: number
  /** Number of model windows the text needed (> 1 = chunked). */
  chunks: number
  /** Content tokens (without [CLS]/[SEP]). */
  tokens: number
  /** Per-sample CPU wall time, tokenisation + all chunks, batch size 1. */
  ms: number
}

export function hfHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HF_HOME ?? join(homedir(), '.cache', 'huggingface')
}

/** `<HF_HOME>/hub/models--<org>--<name>/snapshots/<rev>/<onnxSubdir>`. */
export function modelDir(model: ClassifierModel, home = hfHome()): string {
  return join(
    home,
    'hub',
    `models--${model.repo.replace('/', '--')}`,
    'snapshots',
    model.revision,
    model.onnxSubdir
  )
}

export function scoreCacheFile(
  cacheDir: string,
  model: ClassifierModel
): string {
  return join(
    cacheDir,
    'classifier',
    `${model.id}@${model.revision.slice(0, 12)}.jsonl`
  )
}

/** Unique texts keyed by sha256, in first-seen order. */
export function classifierInput(
  texts: string[]
): Array<{ key: string; text: string }> {
  const seen = new Set<string>()
  const out: Array<{ key: string; text: string }> = []
  for (const text of texts) {
    const key = sha256(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, text })
  }
  return out
}

/** Parse score_onnx.py output; rejects malformed lines instead of guessing. */
export function parseClassifierOutput(
  jsonl: string
): Map<string, ClassifierScore> {
  const out = new Map<string, ClassifierScore>()
  jsonl.split('\n').forEach((line, i) => {
    if (!line.trim()) return
    const row = JSON.parse(line) as Record<string, unknown>
    const { key, prob, chunks, tokens, ms } = row
    if (
      typeof key !== 'string' ||
      typeof prob !== 'number' ||
      !(prob >= 0 && prob <= 1) ||
      typeof chunks !== 'number' ||
      chunks < 1 ||
      typeof tokens !== 'number' ||
      typeof ms !== 'number'
    )
      throw new Error(`classifier output line ${i + 1} is malformed`)
    out.set(key, { prob, chunks, tokens, ms })
  })
  return out
}

export interface RunClassifierOptions {
  /** Python interpreter of the venv with classifier/requirements.txt. */
  python: string
  cacheDir: string
  /** Re-score even if a cached score file exists. */
  rescore?: boolean
  hfHomeDir?: string
}

const execFileP = promisify(execFile)

/**
 * Score every text with `model`, returning one score per sha256(text).
 * Results are cached per model revision under the (gitignored) cache dir, so
 * a re-run reuses both the probabilities and the measured latencies.
 */
export async function runClassifier(
  model: ClassifierModel,
  texts: string[],
  opts: RunClassifierOptions
): Promise<Map<string, ClassifierScore>> {
  const input = classifierInput(texts)
  const outFile = scoreCacheFile(opts.cacheDir, model)
  if (!opts.rescore && existsSync(outFile)) {
    const cached = parseClassifierOutput(await readFile(outFile, 'utf8'))
    if (input.every(r => cached.has(r.key))) return cached
  }
  const dir = modelDir(model, opts.hfHomeDir)
  if (!existsSync(join(dir, 'model.onnx')))
    throw new Error(
      `${model.repo}@${model.revision} not in the HF cache (${dir}); download it first (see README)`
    )
  await mkdir(join(opts.cacheDir, 'classifier'), { recursive: true })
  const inFile = `${outFile}.in`
  await writeFile(inFile, input.map(r => JSON.stringify(r)).join('\n') + '\n')
  await execFileP(
    opts.python,
    [
      join(__dirname, 'classifier', 'score_onnx.py'),
      '--model-dir',
      dir,
      '--in',
      inFile,
      '--out',
      outFile,
      '--max-tokens',
      String(model.maxTokens),
      '--positive-label',
      model.positiveLabel,
    ],
    {
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
      maxBuffer: 64 * 1024 * 1024,
    }
  )
  return parseClassifierOutput(await readFile(outFile, 'utf8'))
}
