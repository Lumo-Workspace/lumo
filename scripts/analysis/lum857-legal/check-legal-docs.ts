/**
 * LUM-857 — checks the three legal live docs (privacy policy, DPA template,
 * subprocessor list) against the facts they must cover.
 *
 * Usage:
 *   npx tsx scripts/analysis/lum857-legal/check-legal-docs.ts <mode>
 *
 * Modes:
 *   subprocessors  every runtime third party + every LLM host in the LUM-854
 *                  ZDR candidate sets (docs/privacy/llm-data-flow.md) is listed,
 *                  each AI host with the global-routing location (LUM-868)
 *   privacy        the privacy policy has each required section
 *   dpa            the DPA template has each GDPR Art.28(3) element
 *
 * The three content modes also reject region wording the LUM-854 region probe
 * disproved (STALE_REGION_CLAIMS).
 *   published      each doc is registered in docs/live-docs/README.md and its
 *                  stored copy keeps the source's table structure
 *
 * Exits non-zero on the first failing mode, listing every gap.
 */
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
const LIVE_DOCS = 'docs/live-docs'

export const LEGAL_DOCS = {
  privacy: `${LIVE_DOCS}/legal-privacy-policy.md`,
  dpa: `${LIVE_DOCS}/legal-dpa-template.md`,
  subprocessors: `${LIVE_DOCS}/legal-subprocessors.md`,
} as const

const MANIFEST = 'docs/privacy/llm-data-flow.md'

/**
 * Gateway provider slug → the name the subprocessor list uses. A slug missing
 * here fails the check, so a new host in the LUM-854 manifest cannot slip past
 * the legal list unnoticed.
 */
export const GATEWAY_HOST_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure',
  alibaba: 'Alibaba Cloud',
  baseten: 'Baseten',
  deepinfra: 'DeepInfra',
  digitalocean: 'DigitalOcean',
  togetherai: 'Together AI',
  nebius: 'Nebius',
  parasail: 'Parasail',
  runware: 'Runware',
  wafer: 'Wafer',
}

/** Services the production runtime sends data to (see LUM-857 PR). */
export const RUNTIME_SERVICES = [
  'Vercel Blob',
  'Vercel Sandbox',
  'Vercel AI Gateway',
  'Neon',
  'Clerk',
  'Pusher',
  'Upstash',
  'Resend',
  'GitHub',
  'Slack',
  'Figma',
  'Google Drive',
  'Sentry',
]

/** Model authors excluded from routing under ZDR — never a processor row. */
export const EXCLUDED_MODEL_AUTHORS = ['DeepSeek', 'Zhipu']

/** [label, pattern] pairs a doc must each match. */
export type Requirement = [string, RegExp]

/**
 * The only "Data location" an AI hosting row may carry. Lumo routes model
 * requests with the gateway's default `global` region (LUM-854 manifest,
 * "数据地域"), so the processing location is not fixed and never promised.
 */
export const AI_HOST_LOCATION = 'Routed globally; no location commitment'

/**
 * Wording the LUM-854 region probe disproved: the gateway can report and pin a
 * region, Lumo just does not pin one. None of the legal docs may say otherwise.
 */
export const STALE_REGION_CLAIMS: Requirement[] = [
  [
    'gateway "does not report/tell us" the region',
    /does not (report|tell us)/i,
  ],
  ['"not confirmed by the gateway" location', /not confirmed by the gateway/i],
]

/** Split a markdown table row into trimmed cells. */
export function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())
}

/** Gateway host slugs named in the manifest's "ZDR 候选集" column. */
export function zdrCandidateHosts(manifest: string): string[] {
  const lines = manifest.split('\n')
  const headerIdx = lines.findIndex(
    l => l.trim().startsWith('|') && l.includes('ZDR 候选集')
  )
  if (headerIdx < 0) throw new Error('manifest has no "ZDR 候选集" table')
  const col = tableCells(lines[headerIdx]!).findIndex(c =>
    c.includes('ZDR 候选集')
  )
  const hosts = new Set<string>()
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.trim().startsWith('|')) break
    const cell = tableCells(line)[col] ?? ''
    for (const part of cell.split(/→|,|、/)) {
      const slug = part.trim()
      if (/^[a-z0-9]+$/.test(slug)) hosts.add(slug)
    }
  }
  return [...hosts].sort()
}

/** Rows of every table whose header contains `headerWord`. */
function tableRows(doc: string, headerWord: string): string[][] {
  const rows: string[][] = []
  const lines = doc.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.trim().startsWith('|') || !lines[i]!.includes(headerWord))
      continue
    for (
      let j = i + 2;
      j < lines.length && lines[j]!.trim().startsWith('|');
      j++
    )
      rows.push(tableCells(lines[j]!))
    i += 1
  }
  return rows
}

export function checkSubprocessors(doc: string, manifest: string): string[] {
  const gaps: string[] = []
  for (const service of RUNTIME_SERVICES)
    if (!doc.includes(service)) gaps.push(`runtime service missing: ${service}`)

  for (const slug of zdrCandidateHosts(manifest)) {
    const name = GATEWAY_HOST_NAMES[slug]
    if (!name) {
      gaps.push(`manifest host "${slug}" has no name mapping — add it here`)
      continue
    }
    const row = tableRows(doc, 'Subprocessor').find(r => r[0]?.includes(name))
    if (!row) gaps.push(`LLM host missing from subprocessor tables: ${name}`)
  }

  const rows = tableRows(doc, 'Subprocessor')
  if (rows.length === 0) gaps.push('no subprocessor table found')
  for (const row of rows) {
    if (row.length < 5 || row.slice(0, 5).some(c => c === ''))
      gaps.push(`row lacks purpose or location: ${row[0] ?? '?'}`)
    for (const author of EXCLUDED_MODEL_AUTHORS)
      if (row[0]?.includes(author))
        gaps.push(`${author} listed as a subprocessor`)
  }
  for (const header of ['Purpose', 'Data location'])
    if (!doc.includes(header)) gaps.push(`column missing: ${header}`)
  return [...gaps, ...checkAiHostLocations(doc)]
}

/** Every AI hosting row states the global-routing, no-commitment location. */
export function checkAiHostLocations(doc: string): string[] {
  const rows = tableRows(doc, 'Models')
  if (rows.length === 0) return ['no AI hosting table found']
  return rows
    .filter(row => row[4] !== AI_HOST_LOCATION)
    .map(row => `AI host location is not "${AI_HOST_LOCATION}": ${row[0]}`)
}

/** Wording the region probe disproved, found anywhere in the doc. */
export function checkStaleRegionClaims(doc: string): string[] {
  return STALE_REGION_CLAIMS.filter(([, re]) => re.test(doc)).map(
    ([label]) => `stale region claim: ${label}`
  )
}

/**
 * LUM-871 — Vercel's ZDR doc: a provider can exclude specific models or
 * features from its ZDR policy and the gateway does not fail those requests.
 * Every legal source that promises ZDR must say so, and must not drop the
 * prompt-cache caveat that applies to Lumo's own requests.
 */
export const ZDR_EXCLUSION_CAVEAT =
  /exclude specific models or features from it[\s\S]*?(does not fail|without the gateway failing)[\s\S]*?cache parts of a prompt/

export const PRIVACY_REQUIREMENTS: Requirement[] = [
  ['account data category', /Account data/],
  ['workspace content category', /Workspace content/],
  ['agent hook events category', /Agent hook events/],
  ['customer code category', /Customer code/],
  ['integration tokens category', /Integration tokens/],
  ['purposes section', /^## How we use data/m],
  ['legal basis', /Legal basis/],
  ['retention section', /^## How long we keep data/m],
  ['right of access', /\*\*Access\*\*/],
  ['right to export', /\*\*Export\*\*/],
  ['right to delete', /\*\*Delete\*\*/],
  ['international transfers section', /^## International transfers/m],
  ['SCC basis for transfers', /Standard Contractual Clauses/],
  ['no-training statement', /do not use .* to train/],
  ['OpenAI safety retention caveat', /safety retention/],
  [
    'boundary-crossing triage ZDR exception',
    /Boundary-crossing triage is the one exception/,
  ],
  ['provider ZDR exclusion caveat', ZDR_EXCLUSION_CAVEAT],
  ['AI global routing', /routed globally/],
  ['AI region caveat', /cannot currently commit to a location/],
  ['subprocessor page reference', /subprocessor page/],
]

export const DPA_REQUIREMENTS: Requirement[] = [
  ['Art.28 reference', /Article 28\(3\)/],
  ['subject matter', /\| Subject matter \|/],
  ['purpose', /\| Purpose \|/],
  ['duration', /\| Duration \|/],
  ['categories of data subjects', /Categories of data subjects/],
  ['categories of personal data', /Categories of personal data/],
  ['documented instructions', /documented instructions/],
  ['confidentiality', /^## 5\. Confidentiality/m],
  [
    'security annex',
    /^## Annex 2 — Technical and organisational security measures/m,
  ],
  ['general subprocessor authorisation', /General authorisation/],
  ['subprocessor change notice', /Change notice/],
  ['objection right', /\*\*Objection\.\*\*/],
  ['flow-down to subprocessors', /Flow-down/],
  ['data subject request assistance', /Data subject requests/],
  ['Art.32-36 assistance', /Articles 32 to 36/],
  ['breach notification', /^## 9\. Security Incidents/m],
  ['deletion or return', /^## 10\. Deletion or return/m],
  ['audits', /^## 11\. Audits/m],
  ['SCC reference', /Implementing Decision \(EU\) 2021\/914/],
  ['SCC modules', /Module Two/],
  ['UK addendum', /UK Addendum/],
  ['no-training commitment', /train artificial intelligence models/],
  ['AI global routing', /routed globally/],
  ['AI no location commitment', /does not commit to a processing location/],
  ['boundary-crossing triage ZDR exception', /Boundary-crossing triage sends/],
  ['provider ZDR exclusion caveat', ZDR_EXCLUSION_CAVEAT],
]

/**
 * Facts the subprocessor list must state beyond its tables (LUM-945 triage
 * exception, LUM-871 provider-side ZDR exclusions).
 */
export const SUBPROCESSOR_REQUIREMENTS: Requirement[] = [
  [
    'boundary-crossing triage ZDR exception',
    /Boundary-crossing triage is the one exception/,
  ],
  ['provider ZDR exclusion caveat', ZDR_EXCLUSION_CAVEAT],
  [
    'Vercel ZDR documentation link',
    /https:\/\/vercel\.com\/docs\/ai-gateway\/security-and-compliance\/zdr/,
  ],
]

export function checkRequirements(doc: string, reqs: Requirement[]): string[] {
  return reqs
    .filter(([, re]) => !re.test(doc))
    .map(([label]) => `missing: ${label}`)
}

/** docId registered for `file` in the live-docs README mapping table. */
export function registeredDocId(readme: string, file: string): string | null {
  const base = path.basename(file)
  for (const line of readme.split('\n')) {
    if (!line.includes(`](${base})`)) continue
    const m = line.match(/`([a-z0-9]{20,})`/)
    if (m) return m[1]!
  }
  return null
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function checkPublished(): string[] {
  const readme = read(`${LIVE_DOCS}/README.md`)
  const gaps: string[] = []
  for (const file of Object.values(LEGAL_DOCS)) {
    const docId = registeredDocId(readme, file)
    if (!docId) {
      gaps.push(`${file} is not registered in ${LIVE_DOCS}/README.md`)
      continue
    }
    try {
      const out = execFileSync(
        'npx',
        ['tsx', 'scripts/verify-live-doc.ts', docId, file],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
      console.log(out.trim())
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string }
      gaps.push(
        `${file} (${docId}) failed verify-live-doc: ${e.stderr ?? e.stdout ?? ''}`
      )
    }
  }
  return gaps
}

function run(mode: string): string[] {
  switch (mode) {
    case 'subprocessors': {
      const doc = read(LEGAL_DOCS.subprocessors)
      return [
        ...checkSubprocessors(doc, read(MANIFEST)),
        ...checkRequirements(doc, SUBPROCESSOR_REQUIREMENTS),
        ...checkStaleRegionClaims(doc),
      ]
    }
    case 'privacy': {
      const doc = read(LEGAL_DOCS.privacy)
      return [
        ...checkRequirements(doc, PRIVACY_REQUIREMENTS),
        ...checkStaleRegionClaims(doc),
      ]
    }
    case 'dpa': {
      const doc = read(LEGAL_DOCS.dpa)
      return [
        ...checkRequirements(doc, DPA_REQUIREMENTS),
        ...checkStaleRegionClaims(doc),
      ]
    }
    case 'published':
      return checkPublished()
    default:
      throw new Error(
        `unknown mode "${mode}" (subprocessors|privacy|dpa|published)`
      )
  }
}

if (require.main === module) {
  const mode = process.argv[2] ?? ''
  try {
    const gaps = run(mode)
    if (gaps.length > 0) {
      console.error(`FAIL ${mode}:\n- ${gaps.join('\n- ')}`)
      process.exit(1)
    }
    console.log(`OK ${mode}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
