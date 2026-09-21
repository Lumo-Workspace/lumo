/**
 * LUM-805: test case run 证据的**读取**侧。
 *
 * 写入侧的权威校验是 `lib/validation/test-case.ts` 的 `evidenceEntrySchema`
 * (zod)。这里是读取侧：`TestCaseRun.evidence` 落库是 `Json`，读回来就是
 * `unknown` —— 可能是历史行、可能是手改过的库、也可能是将来某个新 type。
 * 渲染端不能对它做任何形状假设。
 *
 * 所以这个模块只做一件事：把 unknown **收窄**成能安全渲染的条目，形状对不上
 * 的整条丢掉，绝不抛异常 —— 一条脏证据不该把整段 run 历史炸掉。
 *
 * 放在 shared/ 是因为 web 与 CLI 两边都要读同一份语义（CLI 里 `testcase show`
 * 打 url，web 里出缩略图），语义漂了就会出现「CLI 看得到、页面看不到」这类
 * 只有用户才撞得到的差异。shared/ 不引 zod，这里用手写类型守卫。
 */

export type EvidenceLink = {
  type: 'link'
  url: string
  label?: string
}

export type EvidenceFile = {
  type: 'file'
  url: string
  filename: string
  contentType: string
  size: number
}

export type EvidenceEntry = EvidenceLink | EvidenceFile

/**
 * 能当图片渲染的 content type —— 与上传路由 `ALLOWED_TYPES` 的图片子集一致。
 * 不按扩展名猜：扩展名是用户给的文件名，contentType 才是上传时校验过的。
 */
const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/**
 * 只放行 http(s)。
 *
 * 这个 url 会直接进 `href` / `src`，而 evidence 是 Json 列 —— 一条
 * `javascript:` 或 `data:text/html` 的 url 就是一个存储型 XSS。协议白名单
 * 是这里唯一的防线，别因为「写入侧已经用 z.string().url() 校验过」就删掉它：
 * z.url() 是认 `javascript:` 的，而且历史行根本没走过那条校验。
 */
function isRenderableUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function narrowEntry(value: unknown): EvidenceEntry | null {
  if (!isRecord(value)) return null
  if (!nonEmptyString(value.url) || !isRenderableUrl(value.url)) return null

  if (value.type === 'file') {
    if (!nonEmptyString(value.filename)) return null
    if (!nonEmptyString(value.contentType)) return null
    if (typeof value.size !== 'number' || !Number.isFinite(value.size))
      return null
    return {
      type: 'file',
      url: value.url,
      filename: value.filename,
      contentType: value.contentType,
      size: value.size,
    }
  }

  if (value.type === 'link') {
    return {
      type: 'link',
      url: value.url,
      ...(nonEmptyString(value.label) ? { label: value.label } : {}),
    }
  }

  // 未知 type：丢掉。将来加新 type 的人要同时改这里，否则页面上看不见 ——
  // 这比渲染一个语义不明的东西好。
  return null
}

/** `TestCaseRun.evidence`（Json，读回来是 unknown）→ 可安全渲染的条目。 */
export function parseEvidenceEntries(value: unknown): EvidenceEntry[] {
  if (!Array.isArray(value)) return []
  const entries: EvidenceEntry[] = []
  for (const raw of value) {
    const entry = narrowEntry(raw)
    if (entry) entries.push(entry)
  }
  return entries
}

/** 能不能当图片展示（缩略图 / 大图）。链接类一律不能：我们没下载过它。 */
export function isImageEvidence(entry: EvidenceEntry): entry is EvidenceFile {
  return entry.type === 'file' && IMAGE_CONTENT_TYPES.has(entry.contentType)
}

/**
 * 给人看的名字：文件用原始文件名，链接用 label，没有 label 就退回 url 本身。
 * 绝不返回空串 —— 空的可点区域等于点不着。
 */
export function evidenceLabel(entry: EvidenceEntry): string {
  if (entry.type === 'file') return entry.filename
  return entry.label ?? entry.url
}
