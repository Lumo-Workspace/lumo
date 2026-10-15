// LUM-1155 — parse Mermaid sources with the real `mermaid` parser, outside
// jest (mermaid is ESM-only and cannot load in the jest module graph).
// Reads a JSON array of sources on stdin; prints a JSON array of
// { ok, error } in the same order.
import mermaid from 'mermaid'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const sources = JSON.parse(Buffer.concat(chunks).toString('utf8'))
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
const results = []
for (const source of sources) {
  try {
    const parsed = await mermaid.parse(source)
    results.push({ ok: true, type: parsed ? parsed.diagramType : null })
  } catch (error) {
    results.push({
      ok: false,
      error: String(error && error.message ? error.message : error),
    })
  }
}
process.stdout.write(JSON.stringify(results))
