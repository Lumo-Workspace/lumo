'use client'

import { useIntl } from 'react-intl'
import {
  parseEvidenceEntries,
  isImageEvidence,
  evidenceLabel,
  type EvidenceEntry,
} from '@/shared/src/test-case-evidence'

/**
 * LUM-805: 一条 run 的证据条。
 *
 * 在这之前这里只渲染一句「2 evidence items」的计数文案 —— 截图传上去了，
 * 谁也看不见，证据等于沉掉。计数本身没有信息量：证据的价值就是**被看到**。
 *
 * 所以图片直接出缩略图（能不能信这次执行，往往一眼就看出来了），非图片出带
 * 文件名的链接。计数退到列表的 aria-label 上，读屏仍然报得出「2 项证据」。
 *
 * 点开走新标签页而不是站内灯箱：原图是 blob 上的静态文件，浏览器自带缩放、
 * 另存、旋转，比我们自己搭一层弹窗可靠；也不必把 Radix Dialog 的焦点管理
 * 拖进一个纯展示的场景。
 */

function ImageEvidence({ entry }: { entry: EvidenceEntry }) {
  const label = evidenceLabel(entry)
  return (
    <a
      href={entry.url}
      target='_blank'
      rel='noopener noreferrer'
      title={label}
      className='block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {/* blob 上的证据图 —— 用 img 避免动 next.config 的 remotePatterns
          （与 FigmaLinkCard 同一约定）。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={entry.url}
        alt={label}
        loading='lazy'
        referrerPolicy='no-referrer'
        className='h-16 w-24 rounded-sm border border-border object-cover'
      />
    </a>
  )
}

function FileEvidence({ entry }: { entry: EvidenceEntry }) {
  const label = evidenceLabel(entry)
  return (
    <a
      href={entry.url}
      target='_blank'
      rel='noopener noreferrer'
      title={label}
      className='max-w-[16rem] truncate underline decoration-border underline-offset-2 hover:decoration-foreground'
    >
      {label}
    </a>
  )
}

/**
 * `evidence` 收的是 `TestCaseRun.evidence`，即 Prisma 的 Json —— **未经收窄**
 * 的 unknown。收窄在 shared/src/test-case-evidence.ts 里做，形状对不上的整条
 * 丢掉：一条脏证据不该把整段 run 历史炸掉。
 */
export function EvidenceStrip({
  evidence,
  only,
  exclude,
}: {
  evidence: unknown
  /** LUM-1011: 只画这几个下标（某一步挂的证据）。下标指原始数组。 */
  only?: number[]
  /** LUM-1011: 不画这几个下标（已经挂在某一步下面画过了）。 */
  exclude?: number[]
}) {
  const intl = useIntl()
  // 先按**原始下标**挑，再逐条收窄：逐步结果里的 evidence 下标指向原始数组，
  // 先收窄会让脏条目之后的下标整体错位。
  const raw = Array.isArray(evidence) ? evidence : []
  const picked =
    only || exclude
      ? raw.filter(
          (_, i) => (!only || only.includes(i)) && !(exclude ?? []).includes(i)
        )
      : raw
  const entries = parseEvidenceEntries(picked)
  if (entries.length === 0) return null

  return (
    <ul
      aria-label={intl.formatMessage(
        { id: 'testCases.evidence' },
        { count: entries.length }
      )}
      className='flex basis-full flex-wrap items-center gap-2'
    >
      {entries.map((entry, i) => (
        <li key={`${i}-${entry.url}`} className='flex items-center'>
          {isImageEvidence(entry) ? (
            <ImageEvidence entry={entry} />
          ) : (
            <FileEvidence entry={entry} />
          )}
        </li>
      ))}
    </ul>
  )
}
