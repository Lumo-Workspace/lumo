/**
 * 从评论/文档 HTML 中提取被 @ 的「人」clerkId。
 *
 * 顺序无关:逐个匹配 mention 元素(节点渲染 class 含 "mention"),读其
 * data-mention-type(缺省 = 'user',兼容旧内容)与 data-id;只在 type=user 时
 * 收集 data-id(= clerkId)。排除作者与 __agent__,去重。
 *
 * 实体类型(task/sprint/project/milestone)的 data-id 不是 clerkId,一律跳过 ——
 * 这从根上消除「拿 taskId 当 clerkId 查」的误报。纯函数,永不抛,返回 []。
 */
export function parseMentionedUserClerkIds(
  html: string,
  authorClerkId: string
): string[] {
  const ids: string[] = []
  if (!html) return ids
  const tagRegex = /<(?:span|a)\b[^>]*\bclass="[^"]*\bmention\b[^"]*"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = tagRegex.exec(html)) !== null) {
    const tag = m[0]
    const typeMatch = /data-mention-type="([^"]+)"/.exec(tag)
    const type = typeMatch ? typeMatch[1] : 'user'
    if (type !== 'user') continue
    const idMatch = /data-id="([^"]+)"/.exec(tag)
    const clerkId = idMatch?.[1]
    if (
      clerkId &&
      clerkId !== authorClerkId &&
      clerkId !== '__agent__' &&
      !ids.includes(clerkId)
    ) {
      ids.push(clerkId)
    }
  }
  return ids
}
