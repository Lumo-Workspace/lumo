/**
 * LUM-805: `lumo task testcase show` 的证据行。
 *
 * 在这之前这里只打 `[2 evidence]` —— 知道有两份证据，但拿不到它们，等于没打。
 * 终端里唯一能「打开」一份证据的形式就是 url，所以每条证据自己占一行。
 *
 * 收窄逻辑不在这儿：shared/src/test-case-evidence.ts 是 web 与 CLI 共用的那一
 * 份，语义漂了就会出现「CLI 看得到、页面看不到」这种只有用户才撞得到的差异。
 */
import {
  parseEvidenceEntries,
  evidenceLabel,
  type EvidenceEntry,
} from '../../../shared/src/test-case-evidence'
import { sanitizeField } from './sanitize'

/**
 * 文件名是上传者给的自由文本 —— 直接打进终端就是一条 ANSI 注入路径，换行还会
 * 把「一条证据一行」这个格式撑破。所以先剥控制符，再把剩下的空白压成空格。
 */
function terminalSafe(label: string): string {
  return sanitizeField(label).replace(/\s+/g, ' ').trim()
}

/** 一条可渲染的证据，连同它在原始 `evidence` 数组里的下标。 */
export interface IndexedEvidence {
  rawIndex: number
  entry: EvidenceEntry
}

/**
 * LUM-1185: 逐条收窄并**保留原始下标**——逐步结果里的 evidence 下标指向原始
 * 数组，先整体收窄会让脏条目之后的下标整体错位。与 web `EvidenceStrip` 同一
 * 做法（同样逐条调 shared 的 parseEvidenceEntries）。
 */
export function indexedEvidence(evidence: unknown): IndexedEvidence[] {
  const raw = Array.isArray(evidence) ? evidence : []
  return raw.flatMap((value, rawIndex) =>
    parseEvidenceEntries([value]).map(entry => ({ rawIndex, entry }))
  )
}

/** 只取 / 排除哪些原始下标（某一步挂的证据 / 已在步骤下列过的）。 */
export interface EvidenceFilter {
  only?: readonly number[]
  exclude?: readonly number[]
}

export function selectEvidence(
  evidence: unknown,
  filter: EvidenceFilter = {}
): IndexedEvidence[] {
  return indexedEvidence(evidence).filter(
    ({ rawIndex }) =>
      (!filter.only || filter.only.includes(rawIndex)) &&
      !(filter.exclude ?? []).includes(rawIndex)
  )
}

/**
 * `TestCaseRun.evidence`（Json，读回来是 unknown）→ 打印行。
 *
 * 形状对不上的整条丢掉，绝不抛异常：一条脏证据不该让 `testcase show` 整个挂掉。
 * 返回空数组就是「这条 run 没有可打印的证据」，调用方什么都不打。
 * `filter` 按原始下标挑选（LUM-1185：步骤下只列该步的，run 末尾列其余的）。
 */
export function formatEvidenceLines(
  evidence: unknown,
  indent = '      ',
  filter: EvidenceFilter = {}
): string[] {
  return selectEvidence(evidence, filter).map(({ entry }) => {
    const label = terminalSafe(evidenceLabel(entry))
    // label 退化成 url 本身时（没有 label 的 link）不打两遍。
    return label && label !== entry.url
      ? `${indent}${label}  ${entry.url}`
      : `${indent}${entry.url}`
  })
}
