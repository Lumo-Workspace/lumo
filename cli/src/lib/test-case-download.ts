import * as fs from 'fs'
import * as path from 'path'
import { evidenceLabel } from '../../../shared/src/test-case-evidence'
import { fmtDay } from './format'
import { sanitizeField } from './sanitize'
import { indexedEvidence, type IndexedEvidence } from './test-case-evidence'
import type { ApiContext } from './test-case-api'

/**
 * LUM-1185: `lumo task|milestone testcase download <case> <dir>` —— 把这条用例
 * 全部 run 的证据文件存到本地（`show` 只列 url，不写本地文件）。
 *
 * Lumo 托管的证据（`/api/files/...`）要认证才能读（匿名 401）。这里用当前 CLI
 * 的 API key 去取，但有三条硬约束：
 *
 * 1. **Bearer 只发往已配置的 API origin。** 证据 URL 里存的 origin 可能是预览
 *    域名，也可能是一条成员手填的 link —— 一律只取 pathname，拼到 ctx.base 上，
 *    丢掉 query；`redirect: 'manual'`，重定向即失败，不跟着跳去别的主机。
 * 2. **外部链接只列不下。** 不是 `/api/files/` 的，或是指向别的主机的 link，
 *    打一行 `external link, not downloaded`。
 * 3. **文件名是上传者给的自由文本。** 先清理（防路径穿越 / 控制符），重名加序号，
 *    `wx` 写——绝不覆盖已有文件——并核对落点仍在目标目录内。
 *
 * 单个文件失败打一行 ✗、继续下一个；返回值说是否全部成功，由调用方决定退出码。
 */

export const FILE_ROUTE_PREFIX = '/api/files/'

/** 下载要用到的那几列 run 字段。 */
export interface DownloadableRun {
  id: string
  result: string
  createdAt: string
  evidence: unknown
}

export type EvidenceAction =
  | { kind: 'download'; path: string; filename: string; label: string }
  | { kind: 'external'; url: string; label: string }

function terminalSafe(s: string): string {
  return sanitizeField(s).replace(/\s+/g, ' ').trim()
}

/**
 * 一条证据该下载还是只列出。下载的给出相对 API origin 的路径（不含 query）。
 *
 * 判定「Lumo 托管」：pathname 在 `/api/files/` 下，且要么是服务端写入的 file 条目
 * （存的 origin 可能是预览域名，文件路由与 origin 无关），要么 link 本身就指向
 * 已配置的 API origin。别的主机上碰巧也叫 /api/files/ 的 link 是外部链接。
 */
export function classifyEvidence(
  item: IndexedEvidence,
  apiBase: string
): EvidenceAction {
  const { entry } = item
  const label = terminalSafe(evidenceLabel(entry)) || entry.url
  let url: URL
  try {
    url = new URL(entry.url)
  } catch {
    return { kind: 'external', url: entry.url, label }
  }
  let sameOrigin = false
  try {
    sameOrigin = new URL(apiBase).origin === url.origin
  } catch {
    sameOrigin = false
  }
  const hosted =
    url.pathname.startsWith(FILE_ROUTE_PREFIX) &&
    url.pathname.length > FILE_ROUTE_PREFIX.length &&
    (entry.type === 'file' || sameOrigin)
  if (!hosted) return { kind: 'external', url: entry.url, label }
  const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? ''
  let fromPath = lastSegment
  try {
    fromPath = decodeURIComponent(lastSegment)
  } catch {
    fromPath = lastSegment
  }
  return {
    kind: 'download',
    path: url.pathname,
    filename: entry.type === 'file' ? entry.filename : fromPath,
    label,
  }
}

/** 本地文件名的字节上限（留出 `-N` 序号的余量，低于常见的 255 字节）。 */
const MAX_NAME_BYTES = 200

/**
 * 单个证据文件的下载上限。上传侧本就有大小限制，这里是防御：响应边读边写盘，
 * 超过上限就停、删掉写了一半的文件，不把整个响应先读进内存。
 */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

/**
 * 原文件名 → 安全的本地文件名：去控制符、`/` `\` 换成 `_`、压掉 `..`、去前导点
 * 与空白，剩下的 Windows 保留字符也换掉；空了就叫 `evidence`。结果永远是单个
 * 路径段，不可能是 `.` / `..`。
 */
export function sanitizeEvidenceFilename(name: string): string {
  let s = sanitizeField(name)
  // sanitizeField 之外再兜一层：任何剩下的 C0/C1 控制符都不进文件名。
  s = Array.from(s)
    .filter(ch => {
      const code = ch.codePointAt(0) ?? 0
      return code >= 0x20 && !(code >= 0x7f && code <= 0x9f)
    })
    .join('')
  s = s.replace(/[/\\]/g, '_')
  s = s.replace(/\.{2,}/g, '.')
  s = s.replace(/[<>:"|?*]/g, '_')
  s = s.replace(/\s+/g, ' ')
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  // 文件系统按**字节**限长（常见 255 字节）：按 UTF-8 字节截，保住扩展名，
  // 不在多字节字符中间切。
  if (Buffer.byteLength(s, 'utf8') > MAX_NAME_BYTES) {
    const dot = s.lastIndexOf('.')
    const ext =
      dot > 0 && Buffer.byteLength(s.slice(dot), 'utf8') <= 16
        ? s.slice(dot)
        : ''
    const budget = MAX_NAME_BYTES - Buffer.byteLength(ext, 'utf8')
    let base = ''
    for (const ch of Array.from(ext ? s.slice(0, dot) : s)) {
      if (Buffer.byteLength(base + ch, 'utf8') > budget) break
      base += ch
    }
    s = base.replace(/[.\s]+$/, '') + ext
  }
  return s || 'evidence'
}

/**
 * 重名加序号：`shot.png` → `shot-2.png` → `shot-3.png`。`taken` 是本次已用过的名字
 * （按小写比，大小写不敏感的文件系统上也不撞），`exists` 查目录里原有的文件。
 */
export function uniqueFilename(
  name: string,
  taken: Set<string>,
  exists: (candidate: string) => boolean
): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base}-${n}${ext}`
    if (!taken.has(candidate.toLowerCase()) && !exists(candidate)) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
  }
}

/** 每条 run 一个子目录：`<YYYY-MM-DD>-<result>-<run id 末 8 位>`。 */
export function runDirName(run: DownloadableRun): string {
  const day = fmtDay(run.createdAt)
  const result = run.result.toLowerCase()
  return sanitizeEvidenceFilename(`${day}-${result}-${run.id.slice(-8)}`)
}

function inside(dir: string, file: string): boolean {
  const root = path.resolve(dir)
  const target = path.resolve(file)
  return target.startsWith(root + path.sep)
}

/** 写盘用到的两个底层调用；测试注入以模拟短写 / close 失败。 */
export interface FileIo {
  writeSync: (
    fd: number,
    data: Uint8Array,
    offset: number,
    length: number
  ) => number
  closeSync: (fd: number) => void
}

const NODE_IO: FileIo = {
  writeSync: (fd, data, offset, length) =>
    fs.writeSync(fd, data, offset, length),
  closeSync: fd => fs.closeSync(fd),
}

export interface DownloadDeps {
  fetch?: typeof fetch
  print?: (line: string) => void
  io?: FileIo
}

/**
 * 下载 runs 里全部 Lumo 托管的证据到 `dir/<run 子目录>/`。返回 true = 没有任何
 * 一条失败（外部链接不算失败；没有证据也不算）。
 */
export async function downloadRunsEvidence(
  ctx: ApiContext,
  runs: DownloadableRun[],
  dir: string,
  deps: DownloadDeps = {}
): Promise<boolean> {
  const doFetch = deps.fetch ?? fetch
  const print = deps.print ?? ((line: string) => console.log(line))
  const io = deps.io ?? NODE_IO

  print('')
  print(`Downloading evidence to ${terminalSafe(dir)}:`)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    print(`  ✗ could not create ${terminalSafe(dir)}: ${terminalSafe(msg)}`)
    return false
  }

  let allOk = true
  let any = false
  for (const run of runs) {
    const items = indexedEvidence(run.evidence)
    if (items.length === 0) continue
    any = true
    const runDir = path.join(dir, runDirName(run))
    const taken = new Set<string>()
    for (const item of items) {
      const action = classifyEvidence(item, ctx.base)
      if (action.kind === 'external') {
        const url = terminalSafe(action.url)
        const shown =
          action.label && action.label !== url ? `${action.label}  ${url}` : url
        print(`  ${shown}  (external link, not downloaded)`)
        continue
      }
      const ok = await downloadOne(
        ctx,
        action,
        runDir,
        taken,
        doFetch,
        print,
        io
      )
      if (!ok) allOk = false
    }
  }
  if (!any) print('  no evidence to download')
  return allOk
}

async function downloadOne(
  ctx: ApiContext,
  action: Extract<EvidenceAction, { kind: 'download' }>,
  runDir: string,
  taken: Set<string>,
  doFetch: typeof fetch,
  print: (line: string) => void,
  io: FileIo
): Promise<boolean> {
  const fail = (why: string) => {
    print(`  ✗ ${action.label}: ${terminalSafe(why)}`)
    return false
  }

  let res: Response
  try {
    res = await doFetch(`${ctx.base}${action.path}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      redirect: 'manual',
    })
  } catch (err) {
    return fail(
      `could not reach ${ctx.base} (${err instanceof Error ? err.message : String(err)})`
    )
  }
  if (res.status === 401) return fail('HTTP 401 — the API key was not accepted')
  if (!res.ok) return fail(`HTTP ${res.status}`)

  const declared = Number(res.headers?.get?.('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES)
    return fail(`larger than ${MAX_DOWNLOAD_BYTES} bytes, not downloaded`)

  try {
    fs.mkdirSync(runDir, { recursive: true })
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  const name = uniqueFilename(
    sanitizeEvidenceFilename(action.filename),
    taken,
    candidate => fs.existsSync(path.join(runDir, candidate))
  )
  const target = path.join(runDir, name)
  if (!inside(runDir, target)) return fail('unsafe file name')

  let fd: number
  try {
    fd = fs.openSync(target, 'wx')
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  // 每个 fd 只关一次；关闭失败只算这一个文件失败，绝不抛出去打断后面的文件。
  let closed = false
  const closeOnce = (): string | null => {
    if (closed) return null
    closed = true
    try {
      io.closeSync(fd)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }
  // 只删本次刚用 wx 新建的那个文件（写了一半的）；删不掉也不抛。
  const discard = (why: string) => {
    closeOnce()
    try {
      fs.rmSync(target, { force: true })
    } catch {
      // 留下的残件由 ✗ 行提示；不能让它中断后续下载。
    }
    return fail(why)
  }

  let received: number
  try {
    received = await writeBody(res, fd, io)
  } catch (err) {
    return discard(err instanceof Error ? err.message : String(err))
  }
  const closeError = closeOnce()
  if (closeError) return discard(closeError)
  // 最后核对：盘上的字节数必须等于收到的字节数，否则当作失败。
  let onDisk = -1
  try {
    onDisk = fs.statSync(target).size
  } catch {
    onDisk = -1
  }
  if (onDisk !== received)
    return discard(
      `wrote ${onDisk < 0 ? 'an unknown number of' : onDisk} of ${received} bytes`
    )
  print(`  saved ${terminalSafe(target)}`)
  return true
}

/**
 * 把一块数据全部写进 fd：`writeSync` 可能短写（返回值小于请求长度），循环写到
 * 写完为止；一次写出 0 字节视为无法前进，抛错。返回写入的字节数。
 */
export function writeAllSync(
  fd: number,
  data: Uint8Array,
  io: Pick<FileIo, 'writeSync'> = NODE_IO
): number {
  let offset = 0
  while (offset < data.byteLength) {
    const n = io.writeSync(fd, data, offset, data.byteLength - offset)
    if (!Number.isInteger(n) || n <= 0)
      throw new Error(
        `short write: ${offset} of ${data.byteLength} bytes written`
      )
    offset += n
  }
  return offset
}

/**
 * 边读边写；超过 {@link MAX_DOWNLOAD_BYTES} 就抛错。没有流式 body 时退回整读。
 * 返回收到（= 已写入）的字节数，调用方拿它和盘上大小核对。
 */
async function writeBody(
  res: Response,
  fd: number,
  io: FileIo
): Promise<number> {
  const tooLarge = () =>
    new Error(`larger than ${MAX_DOWNLOAD_BYTES} bytes, stopped`)
  let received = 0
  let written = 0
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      written += writeAllSync(fd, value, io)
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer())
    received = buf.length
    if (received > MAX_DOWNLOAD_BYTES) throw tooLarge()
    written = writeAllSync(fd, buf, io)
  }
  if (written !== received)
    throw new Error(`wrote ${written} of ${received} bytes`)
  return received
}
