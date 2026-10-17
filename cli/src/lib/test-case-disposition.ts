import { fmtDay } from './format'
/**
 * LUM-812: `lumo task testcase disposition` 的纯函数。
 *
 * 抽出来单独测的理由同 `./test-case-verdict.ts`：这里藏着三步握手的**本地顺序
 * 检查**和两个信封的措辞，而这两样正是这条命令唯一的产出——服务端会把顺序再
 * 查一遍，但本地先拦一道能在任何请求发出去之前就把缺的那一步指出来。
 *
 * 措辞与越界那条命令刻意同构：同一套三步协议不该长出两种说法。
 */

import { sanitizeField } from './sanitize'

export type DefectRuling = 'KNOWN_DEFECT' | 'NOT_A_DEFECT'

/**
 * LUM-1135: 用例属于任务还是里程碑。任务上两个裁定都清 DONE 闸；里程碑上只有
 * KNOWN_DEFECT 放行关闭闸，NOT_A_DEFECT 让这条用例继续拦着、直到重跑通过。
 */
export type DefectOwnerKind = 'task' | 'milestone'

export interface DispositionFlags {
  knownDefect?: boolean
  notADefect?: boolean
  confirmRead?: boolean
  confirm?: boolean
  receipt?: string
}

export type RulingPick =
  | { ok: true; target: DefectRuling }
  | { ok: false; error: string }

/** 恰好一个裁定值。两个都给或都不给都是错——这不是可以默认的东西。 */
export function pickRuling(
  flags: DispositionFlags,
  ownerKind: DefectOwnerKind = 'task'
): RulingPick {
  const picked = [
    flags.knownDefect ? ('KNOWN_DEFECT' as const) : null,
    flags.notADefect ? ('NOT_A_DEFECT' as const) : null,
  ].filter(Boolean) as DefectRuling[]

  if (picked.length !== 1) {
    return {
      ok: false,
      error:
        'pass exactly one of --known-defect or --not-a-defect (the ruling to record). ' +
        (ownerKind === 'task'
          ? 'Both clear the gate — the gate asks whether a human has looked, not whether the defect is fixed.'
          : 'Only --known-defect lets the milestone close; --not-a-defect keeps the case holding the milestone until it passes on a re-run.'),
    }
  }
  return { ok: true, target: picked[0]! }
}

export type StepCheck =
  | { ok: true; step: 'READ' | 'ACK' | 'WRITE' }
  | { ok: false; error: string }

/**
 * 本地顺序检查。服务端会把这些全部重查一遍——这里只是为了不让人白跑一趟网络，
 * 并且把「缺的是哪一步」当场说清。
 *
 * 回执的前缀就是它的阶段（`r1.` = 读过，`r2.` = 确认读过），所以拿错阶段的回执
 * 在发请求之前就能认出来。
 */
export function checkStep(flags: DispositionFlags): StepCheck {
  const receipt = flags.receipt?.trim() || undefined

  if (flags.confirmRead && flags.confirm) {
    return {
      ok: false,
      error:
        '--confirm-read and --confirm are separate steps — run them one at a time, each from the envelope the previous step printed.',
    }
  }

  if (flags.confirm) {
    if (!receipt) {
      return {
        ok: false,
        error:
          '--confirm requires the stage-2 read receipt (--receipt <token>) from the --confirm-read step. Run the command without any step flag first, relay the envelope, confirm the read, relay that envelope, then re-run its confirmCommand verbatim.',
      }
    }
    if (receipt.startsWith('r1.')) {
      return {
        ok: false,
        error:
          'read not yet acknowledged — this is the stage-1 receipt. Run the command with --confirm-read --receipt <this token> first (after the user confirms they read the envelope); only the receipt that step returns is accepted with --confirm.',
      }
    }
    return { ok: true, step: 'WRITE' }
  }

  if (flags.confirmRead) {
    if (!receipt) {
      return {
        ok: false,
        error:
          '--confirm-read requires the read receipt (--receipt <token>) from the envelope. Run the command without any step flag first and relay the envelope.',
      }
    }
    if (receipt.startsWith('r2.')) {
      return {
        ok: false,
        error:
          'this receipt already acknowledges the read — the next step is --confirm with this same receipt (after the user approves the ruling).',
      }
    }
    return { ok: true, step: 'ACK' }
  }

  return { ok: true, step: 'READ' }
}

export interface DefectSubject {
  caseHandle: string
  caseTitle: string
  runId: string
  recordedAt: string
  evidenceCount: number
}

const RULING_WORD: Record<DefectOwnerKind, Record<DefectRuling, string>> = {
  task: {
    KNOWN_DEFECT: 'KNOWN_DEFECT (we accept this defect and ship anyway)',
    NOT_A_DEFECT:
      'NOT_A_DEFECT (the failure was mis-attributed to the implementation)',
  },
  milestone: {
    KNOWN_DEFECT:
      'KNOWN_DEFECT (we accept this defect and let the milestone close anyway)',
    NOT_A_DEFECT:
      'NOT_A_DEFECT (the failure was mis-attributed to the implementation — the case stays held until it passes on a re-run)',
  },
}

/** 第 1 步信封的后果行。任务措辞保持原样（逐字节）。 */
function readConsequence(
  target: DefectRuling,
  ownerKind: DefectOwnerKind
): string {
  if (ownerKind === 'task')
    return "⚠ Approving this clears that run's block on DONE. It does NOT mean the defect is fixed — it means a human looked and decided."
  return target === 'KNOWN_DEFECT'
    ? '⚠ Approving this stops that run holding the milestone close gate. It does NOT mean the defect is fixed — it means a human looked and decided.'
    : '⚠ Approving this does NOT open the milestone close gate — the case stays held until it passes on a re-run. It records that a human looked and decided the failure is not an implementation defect.'
}

/** 第 2 步信封的后果行。 */
function rulingConsequence(
  target: DefectRuling,
  ownerKind: DefectOwnerKind
): string {
  if (ownerKind === 'task')
    return '⚠ This clears the DONE block for that run. A later run that proves the defect again will block afresh.'
  return target === 'KNOWN_DEFECT'
    ? '⚠ This stops that run holding the milestone close gate. A later run that proves the defect again will hold it afresh.'
    : '⚠ The case still holds the milestone close gate until it passes on a re-run.'
}

/** 第 1 步信封的 changes 行：先说清在裁什么，再说裁定的后果。 */
export function describeDefectRead(
  subject: DefectSubject,
  target: DefectRuling,
  note?: string,
  ownerKind: DefectOwnerKind = 'task'
): string[] {
  const lines = [
    `Will rule on ${subject.caseHandle} "${subject.caseTitle}" — its latest run proved an implementation defect`,
    `Latest run recorded ${subject.recordedAt} with ${subject.evidenceCount} evidence entr${
      subject.evidenceCount === 1 ? 'y' : 'ies'
    }`,
    `Ruling to record: ${RULING_WORD[ownerKind][target]}`,
  ]
  if (note) lines.push(`Note: ${note}`)
  lines.push(readConsequence(target, ownerKind))
  return lines
}

/** 第 2 步信封:读已确认,现在确认裁定本身。 */
export function describeDefectRuling(
  subject: DefectSubject,
  target: DefectRuling,
  args: {
    readAt: string
    readAcknowledgedAt: string
    note?: string | undefined
  },
  ownerKind: DefectOwnerKind = 'task'
): string[] {
  const lines = [
    `Read acknowledged for ${subject.caseHandle} "${subject.caseTitle}" (shown ${args.readAt}, acknowledged ${args.readAcknowledgedAt})`,
    `Step 2 of 2 — record the ruling: ${RULING_WORD[ownerKind][target]}`,
  ]
  if (args.note) lines.push(`Note: ${args.note}`)
  lines.push(rulingConsequence(target, ownerKind))
  return lines
}

/**
 * `testcase show` 里挂在一条 run 底下的裁定行。没有裁定（或形状不认识）→ null，
 * 一行都不打——与证据行同样的「脏数据不让 show 挂掉」口径。
 *
 * 裁定清掉的是「拦」，不是「有这回事」：那条 run 照常显示，只是多一行说明
 * 谁在哪条路上拍过板。旧服务端不发 `disposition` 字段，同样落到 null。
 */
export function formatDispositionLine(disposition: unknown): string | null {
  if (!disposition || typeof disposition !== 'object') return null
  const d = disposition as Record<string, unknown>
  if (d.disposition !== 'KNOWN_DEFECT' && d.disposition !== 'NOT_A_DEFECT')
    return null
  const channel =
    d.channel === 'CLI' || d.channel === 'WEB' ? ` via ${d.channel}` : ''
  const at =
    typeof d.dispositionedAt === 'string' ? ` ${fmtDay(d.dispositionedAt)}` : ''
  const note =
    typeof d.note === 'string' && d.note.trim()
      ? `  — ${sanitizeField(d.note.trim())}`
      : ''
  return `      ✓ ruled ${d.disposition}${channel}${at}${note}`
}
