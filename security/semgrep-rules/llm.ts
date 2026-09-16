// LUM-785 — fixtures for `llm.yaml`, consumed by `semgrep --test` (run via
// `npx tsx scripts/security/semgrep-rules-test.ts`). Deliberately NOT real
// code: excluded from tsc (tsconfig `exclude`) and eslint. Each `ruleid:`
// comment marks the next line as a required match; each `ok:` line must stay
// silent. Keep this file free of other rule packs' triggers and of any
// llm-output→sink flow (that is the graph rule's fixture, not this one).
import { generateText, generateObject, streamText } from 'ai'
import { z } from 'zod'

declare const openai: {
  chat: { completions: { create: (a: unknown) => unknown } }
}
declare const model: unknown
declare const SYSTEM_PROMPT: string
const QuerySchema = z.object({ q: z.string().max(200) })

// ── lumo.llm.untrusted-input-in-prompt ─────────────────────────────────────

export async function messagesFromBody(req: Request) {
  const body = await req.json()
  return openai.chat.completions.create({
    model,
    // ruleid: lumo.llm.untrusted-input-in-prompt
    messages: [{ role: 'user', content: `Summarise: ${body.text}` }],
  })
}

export async function promptFromSearchParams(req: {
  nextUrl: { searchParams: URLSearchParams }
}) {
  const q = req.nextUrl.searchParams.get('q')
  return openai.chat.completions.create({
    model,
    // ruleid: lumo.llm.untrusted-input-in-prompt
    prompt: 'Answer: ' + q,
  })
}

export function promptFromParam(userText: string) {
  return openai.chat.completions.create({
    model,
    // ruleid: lumo.llm.untrusted-input-in-prompt
    prompt: `Rewrite this: ${userText}`,
  })
}

export async function systemFromFormData(req: Request) {
  const formData = await req.formData()
  return openai.chat.completions.create({
    model,
    // ruleid: lumo.llm.untrusted-input-in-prompt, lumo.llm.system-prompt-from-runtime-value
    system: `You are ${formData.get('persona')}`,
  })
}

export async function parsedBeforePrompt(req: Request) {
  const parsed = QuerySchema.parse(await req.json())
  return openai.chat.completions.create({
    model,
    // ok: lumo.llm.untrusted-input-in-prompt
    messages: [{ role: 'user', content: `Summarise: ${parsed.q}` }],
  })
}

export async function safeParsedBeforePrompt(req: Request) {
  const result = QuerySchema.safeParse(await req.json())
  if (!result.success) return null
  return openai.chat.completions.create({
    model,
    // ok: lumo.llm.untrusted-input-in-prompt
    prompt: `Summarise: ${result.data.q}`,
  })
}

export function constantPrompt() {
  return openai.chat.completions.create({
    model,
    // ok: lumo.llm.untrusted-input-in-prompt
    system: SYSTEM_PROMPT,
    // ok: lumo.llm.untrusted-input-in-prompt
    messages: [{ role: 'user', content: 'Say hello' }],
  })
}

// LUM-793 — `content` is a sink only as a MESSAGE part (an object that also
// carries `role`). A domain object that merely has a `content` field is not a
// prompt, however untrusted its text: the repo is full of them (memory cards,
// comments, documents, artifacts) and matching the bare property name made 101
// of them findings.

declare function screenMemoryContent(input: {
  category: string
  content: unknown
}): boolean

export function domainObjectWithContentField(content: unknown) {
  // ok: lumo.llm.untrusted-input-in-prompt
  return screenMemoryContent({ category: 'TRAP', content })
}

declare function pushTurn(turn: { role: string; content: string }): void

export function messagePartOutsideMessagesArray(userText: string) {
  // ruleid: lumo.llm.untrusted-input-in-prompt
  pushTurn({ role: 'user', content: `Summarise: ${userText}` })
}

// ── lumo.llm.untrusted-input-in-ai-sdk-prompt ──────────────────────────────

export async function aiSdkPromptFromBody(req: Request) {
  const body = await req.json()
  return generateText({
    model,
    // ruleid: lumo.llm.untrusted-input-in-ai-sdk-prompt
    prompt: `Summarise: ${body.text}`,
  })
}

export async function aiSdkSystemFromParams(params: { persona: string }) {
  return generateObject({
    model,
    schema: QuerySchema,
    // ruleid: lumo.llm.untrusted-input-in-ai-sdk-prompt, lumo.llm.system-prompt-from-runtime-value
    system: 'You are ' + params.persona,
    prompt: 'Describe yourself',
  })
}

export const aiSdkMessagesFromArrow = async (input: string) =>
  streamText({
    model,
    // ruleid: lumo.llm.untrusted-input-in-ai-sdk-prompt
    messages: [{ role: 'user', content: `Q: ${input}` }],
  })

export async function aiSdkParsedBeforePrompt(req: Request) {
  const parsed = QuerySchema.parse(await req.json())
  return generateText({
    model,
    // ok: lumo.llm.untrusted-input-in-ai-sdk-prompt
    prompt: `Summarise: ${parsed.q}`,
  })
}

export async function aiSdkConstantPrompt() {
  return generateText({
    model,
    // ok: lumo.llm.untrusted-input-in-ai-sdk-prompt
    system: SYSTEM_PROMPT,
    // ok: lumo.llm.untrusted-input-in-ai-sdk-prompt
    prompt: 'Say hello',
  })
}

// ── lumo.llm.system-prompt-from-runtime-value ──────────────────────────────

export function systemFromTemplate(persona: string) {
  return generateText({
    model,
    // ruleid: lumo.llm.system-prompt-from-runtime-value, lumo.llm.untrusted-input-in-ai-sdk-prompt
    system: `You are ${persona}. Be brief.`,
    prompt: 'Hi',
  })
}

export function systemFromConcat(persona: string) {
  return openai.chat.completions.create({
    model,
    // ruleid: lumo.llm.system-prompt-from-runtime-value, lumo.llm.untrusted-input-in-prompt
    system: 'You are ' + persona,
  })
}

export function systemMessageFromTemplate(persona: string) {
  return openai.chat.completions.create({
    model,
    // ruleid: lumo.llm.untrusted-input-in-prompt
    messages: [
      // ruleid: lumo.llm.system-prompt-from-runtime-value
      { role: 'system', content: `You are ${persona}` },
      { role: 'user', content: 'Hi' },
    ],
  })
}

export function systemConstant() {
  return generateText({
    model,
    // ok: lumo.llm.system-prompt-from-runtime-value
    system: SYSTEM_PROMPT,
    prompt: 'Hi',
  })
}

export function systemConstantInterpolation() {
  return generateText({
    model,
    // ok: lumo.llm.system-prompt-from-runtime-value
    system: `${SYSTEM_PROMPT}\nAnswer in English.`,
    prompt: 'Hi',
  })
}

export function systemLiteralConcat() {
  return generateText({
    model,
    // ok: lumo.llm.system-prompt-from-runtime-value
    system: 'You are a helpful assistant. ' + 'Be brief.',
    prompt: 'Hi',
  })
}
