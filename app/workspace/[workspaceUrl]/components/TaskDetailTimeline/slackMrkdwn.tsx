import React from 'react'

/**
 * Render a small subset of Slack mrkdwn into React nodes. Handles:
 *   *bold* → <strong>
 *   _italic_ → <em>
 *   <@U123> → @<userId or resolved name from map>
 *   <#CHANNEL|name> → #name
 *   <http://example.com|label> → <a>label</a>
 * Other mrkdwn (block quotes, lists) is rendered as plain text.
 */
export function SlackMrkdwn({
  text,
  userMap,
}: {
  text: string
  userMap?: Record<string, string | null>
}): React.ReactElement {
  const parts: Array<string | React.ReactElement> = []
  let i = 0
  let key = 0

  while (i < text.length) {
    const open = text.indexOf('<', i)
    if (open === -1) {
      parts.push(text.slice(i))
      break
    }
    if (open > i) parts.push(text.slice(i, open))
    const close = text.indexOf('>', open + 1)
    if (close === -1) {
      parts.push(text.slice(open))
      break
    }
    const token = text.slice(open + 1, close)
    if (token.startsWith('@') && /^@[UW][A-Z0-9]+$/.test(token)) {
      const uid = token.slice(1)
      const name = userMap?.[uid] ?? null
      parts.push(
        <span key={key++} className='text-info-text'>
          @{name ?? uid}
        </span>
      )
    } else if (token.startsWith('#')) {
      const pipe = token.indexOf('|')
      const name = pipe >= 0 ? token.slice(pipe + 1) : 'channel'
      parts.push(
        <span key={key++} className='text-info-text'>
          #{name}
        </span>
      )
    } else if (/^https?:\/\//.test(token)) {
      const pipe = token.indexOf('|')
      const url = pipe >= 0 ? token.slice(0, pipe) : token
      const label = pipe >= 0 ? token.slice(pipe + 1) : url
      parts.push(
        <a
          key={key++}
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          className='text-info-text underline'
        >
          {label}
        </a>
      )
    } else {
      parts.push(`<${token}>`)
    }
    i = close + 1
  }

  // Now apply bold/italic to plain-string parts. Keep elements as-is.
  const rendered = parts.flatMap((p, idx) =>
    typeof p === 'string' ? applyEmphasis(p, idx, key) : [p]
  )

  return <>{rendered}</>
}

function applyEmphasis(
  s: string,
  baseKey: number,
  _k: number
): React.ReactNode[] {
  // Minimal: *bold* and _italic_, non-overlapping, no escaping. Good enough
  // for typical Slack messages; we accept that pathological inputs render
  // verbatim.
  const out: React.ReactNode[] = []
  const re = /(\*[^*]+\*|_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('*')) {
      out.push(<strong key={`b-${baseKey}-${i++}`}>{tok.slice(1, -1)}</strong>)
    } else {
      out.push(<em key={`i-${baseKey}-${i++}`}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
