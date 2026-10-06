/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as path from 'path'

import * as models from '@/lib/ai/models'
import {
  AI_HOST_SUBPROCESSORS,
  CUSTOMER_INTEGRATIONS,
  INFRASTRUCTURE_SUBPROCESSORS,
  SECURITY_CONTACT_EMAIL,
} from '@/lib/legal/subprocessors'
import {
  NOTICE_PERIOD_DAYS,
  PRIVACY_CONTACT_EMAIL,
  SUBPROCESSOR_BASELINE_DATE,
  SUBPROCESSOR_CHANGES,
} from '@/lib/legal/subprocessor-changes'
import {
  AI_HOST_LOCATION,
  EXCLUDED_MODEL_AUTHORS,
  tableCells,
  zdrCandidateHosts,
} from '../../../scripts/analysis/lum857-legal/check-legal-docs'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const MANIFEST = read('docs/privacy/llm-data-flow.md')
const LEGAL_DOC = read('docs/live-docs/legal-subprocessors.md')

/** Body rows of the first markdown table whose header starts with `prefix`. */
function tableAfter(doc: string, prefix: string): string[][] {
  const lines = doc.split('\n')
  const start = lines.findIndex(l => l.trim().startsWith(prefix))
  if (start < 0) throw new Error(`no table with header "${prefix}"`)
  const rows: string[][] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break
    rows.push(tableCells(line))
  }
  return rows
}

/** The manifest's "模型 × 实际供应商" table: model id + every host slug named. */
function manifestModelRows(): { model: string; hosts: string[] }[] {
  const rows = tableAfter(MANIFEST, '| 模型常量')
  return rows.map(cells => ({
    model: (cells[1] ?? '').replace(/`/g, ''),
    hosts: [cells[2] ?? '', cells[3] ?? '']
      .flatMap(c => c.split(/→|,|、/))
      .map(s => s.trim())
      .filter(s => /^[a-z0-9]+$/.test(s)),
  }))
}

function runtimeModelIds(): string[] {
  const chat = Object.entries(models)
    .filter(([name, v]) => name.endsWith('_MODEL') && typeof v === 'string')
    .map(([, v]) => v as string)
  // lib/ai/embedding.ts imports the gateway (jest-hostile), so read its id.
  const embedding = read('lib/ai/embedding.ts').match(
    /export const EMBEDDING_MODEL = '([^']+)'/
  )?.[1]
  if (!embedding) throw new Error('EMBEDDING_MODEL not found')
  return [...new Set([...chat, embedding])].sort()
}

const sorted = (xs: string[]) => [...xs].sort()

describe('subprocessor registry (LUM-856)', () => {
  it('subprocessor registry stays in step with the model registry and the legal doc', () => {
    // 1. Every model the runtime calls is accounted for in the ZDR manifest,
    //    with at least one host — a new model can't skip the manifest.
    const manifestRows = manifestModelRows()
    const unlisted = runtimeModelIds().filter(
      id => !manifestRows.some(r => r.model === id && r.hosts.length > 0)
    )
    expect(unlisted).toEqual([])

    // 2. The registry's AI hosts are exactly the hosts those models can reach.
    const reachable = new Set([
      ...zdrCandidateHosts(MANIFEST),
      ...manifestRows.flatMap(r => r.hosts),
    ])
    expect(sorted(AI_HOST_SUBPROCESSORS.map(h => h.gatewaySlug))).toEqual(
      sorted([...reachable])
    )
    for (const author of EXCLUDED_MODEL_AUTHORS)
      expect(
        AI_HOST_SUBPROCESSORS.filter(h => h.entity.includes(author))
      ).toEqual([])

    // 3. The legal doc and the registry list the same parties, both ways.
    expect(
      sorted(
        tableAfter(LEGAL_DOC, '| Subprocessor | Service').map(
          r => `${r[0]} / ${r[1]}`
        )
      )
    ).toEqual(
      sorted(
        INFRASTRUCTURE_SUBPROCESSORS.map(s => `${s.entity} / ${s.docService}`)
      )
    )
    expect(
      sorted(tableAfter(LEGAL_DOC, '| Subprocessor | Models').map(r => r[0]!))
    ).toEqual(sorted(AI_HOST_SUBPROCESSORS.map(h => h.entity)))
    expect(
      sorted(
        tableAfter(LEGAL_DOC, '| Service | Provider').map(
          r => `${r[0]} / ${r[1]}`
        )
      )
    ).toEqual(
      sorted(CUSTOMER_INTEGRATIONS.map(i => `${i.service} / ${i.provider}`))
    )
  })

  it('AI hosts show the legal doc global routing location on the page', () => {
    // LUM-868: the doc promises no AI processing location, so the page may
    // not show a fixed one (e.g. United States) for any AI host either.
    const docLocations = new Set(
      tableAfter(LEGAL_DOC, '| Subprocessor | Models').map(r => r[4])
    )
    expect([...docLocations]).toEqual([AI_HOST_LOCATION])
    expect(
      AI_HOST_SUBPROCESSORS.filter(h => h.location !== 'globalRouting')
    ).toEqual([])
  })

  it('legal doc change section matches the change log and the notice mechanism LUM-919', () => {
    const changes = LEGAL_DOC.slice(
      LEGAL_DOC.indexOf('## Changes to this list')
    )
    // The promise the send script keeps: owners of every workspace, by email,
    // NOTICE_PERIOD_DAYS ahead, automatically; others via the privacy contact.
    expect(changes).toMatch(/by email to the owners of every workspace/)
    expect(changes).toContain(`at least [${NOTICE_PERIOD_DAYS}] days`)
    expect(changes).toMatch(/notified automatically/)
    expect(changes).toContain(`[${PRIVACY_CONTACT_EMAIL}]`)
    expect(changes).not.toMatch(/To receive notifications/)

    const history = changes.slice(changes.indexOf('### Change history'))
    if (SUBPROCESSOR_CHANGES.length === 0) {
      expect(history).toContain(
        `No changes have been recorded since the change history started on ${SUBPROCESSOR_BASELINE_DATE}.`
      )
    } else {
      // | Change | Announced | Takes effect | Summary |
      expect(
        sorted(
          tableAfter(history, '| Change | Announced').map(r => r.join(' / '))
        )
      ).toEqual(
        sorted(
          SUBPROCESSOR_CHANGES.map(c =>
            [c.id, c.announcedAt, c.effectiveAt, c.summary].join(' / ')
          )
        )
      )
    }
  })

  it('flags a model id missing from the ZDR manifest', () => {
    const rows = manifestModelRows()
    expect(rows.some(r => r.model === 'openai/gpt-5.5')).toBe(true)
    expect(rows.some(r => r.model === 'example/not-a-model')).toBe(false)
  })

  it('security txt carries the registry contact and an expiry', () => {
    const txt = read('public/.well-known/security.txt')
    const field = (name: string) =>
      txt.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1]?.trim()

    expect(field('Contact')).toBe(`mailto:${SECURITY_CONTACT_EMAIL}`)
    // RFC 9116 §2.5.5: Expires is required, in RFC 3339 format.
    const expires = field('Expires')
    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
    expect(Number.isNaN(Date.parse(expires!))).toBe(false)
    expect(field('Policy')).toBe('https://www.uselumo.ai/security')
  })
})
