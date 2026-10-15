// LUM-1155 — parse Mermaid sources with the real `mermaid` parser, outside
// jest (mermaid is ESM-only and cannot load in the jest module graph).
// Reads a JSON array of sources on stdin; prints a JSON array of
// { ok, type, arrows } / { ok, error } in the same order. `arrows` (sequence
// diagrams only) is each message as Mermaid itself read it: from, to and
// whether the line is 'solid' (a call) or 'dotted' (a reply).
import mermaid from 'mermaid'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const sources = JSON.parse(Buffer.concat(chunks).toString('utf8'))
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
/** The messages of a sequence diagram, with their line style. */
async function arrowsOf(source) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
  const { LINETYPE } = diagram.db
  const style = new Map([
    [LINETYPE.SOLID, 'solid'],
    [LINETYPE.SOLID_OPEN, 'solid'],
    [LINETYPE.SOLID_CROSS, 'solid'],
    [LINETYPE.SOLID_POINT, 'solid'],
    [LINETYPE.DOTTED, 'dotted'],
    [LINETYPE.DOTTED_OPEN, 'dotted'],
    [LINETYPE.DOTTED_CROSS, 'dotted'],
    [LINETYPE.DOTTED_POINT, 'dotted'],
  ])
  return diagram.db
    .getMessages()
    .filter(m => m.from && m.to)
    .map(m => ({ from: m.from, to: m.to, line: style.get(m.type) ?? 'other' }))
}

const results = []
for (const source of sources) {
  try {
    const parsed = await mermaid.parse(source)
    const result = { ok: true, type: parsed ? parsed.diagramType : null }
    if (result.type === 'sequence') result.arrows = await arrowsOf(source)
    results.push(result)
  } catch (error) {
    results.push({
      ok: false,
      error: String(error && error.message ? error.message : error),
    })
  }
}
process.stdout.write(JSON.stringify(results))
