export interface ParsedReport {
  todayFocus: string[]
  riskNarrative: string
  raw: string
}

const HEADERS = {
  focus: ["## Today's Focus", '## 今日关注'],
  risk: ['## Risk', '## 风险'],
}

const BULLET_RE = /^[-*]\s+/

function normalizeHeader(line: string): string {
  return line.trim()
}

export function parseReport(report: string, _locale: string): ParsedReport {
  const raw = report
  if (!report) {
    return { todayFocus: [], riskNarrative: '', raw }
  }

  const lines = report.split('\n')
  const sections: Array<{ header: string; body: string[] }> = []
  let current: { header: string; body: string[] } | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { header: normalizeHeader(line), body: [] }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) sections.push(current)

  let todayFocus: string[] = []
  let riskNarrative = ''

  for (const section of sections) {
    if (HEADERS.focus.includes(section.header)) {
      todayFocus = section.body
        .map(l => l.trim())
        .filter(l => BULLET_RE.test(l))
        .map(l => l.replace(BULLET_RE, '').trim())
        .filter(Boolean)
    } else if (HEADERS.risk.includes(section.header)) {
      riskNarrative = section.body
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
    }
  }

  return { todayFocus, riskNarrative, raw }
}
