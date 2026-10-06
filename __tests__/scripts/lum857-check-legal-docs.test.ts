/**
 * @jest-environment node
 */
import {
  AI_HOST_LOCATION,
  checkAiHostLocations,
  checkRequirements,
  checkStaleRegionClaims,
  checkSubprocessors,
  registeredDocId,
  tableCells,
  zdrCandidateHosts,
} from '../../scripts/legal/check-legal-docs'

const MANIFEST = [
  '| 模型常量 | 模型 | 本次落点 | ZDR 候选集(按 Gateway 执行顺序) | 被排除 |',
  '| --- | --- | --- | --- | --- |',
  '| `A` | `openai/x` | openai | openai → azure | bedrock |',
  '| `B` | `x/y` | alibaba | alibaba、baseten | **deepseek(官方)** |',
  '| `C` | `x/z` | alibaba | 同上 | 同上 |',
  '| `E` | `e` | deepinfra | (embedding 响应不回显路由) | — |',
  '',
  'after',
].join('\n')

const RUNTIME =
  'Vercel Blob Vercel Sandbox Vercel AI Gateway Neon Clerk Pusher Upstash Resend GitHub Slack Figma Google Drive Sentry'

function subprocessorDoc(rows: string[]): string {
  return [
    RUNTIME,
    '| Subprocessor | Models | Purpose | Retention | Data location |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

const ALL_HOSTS = [
  'OpenAI, L.L.C.',
  'Microsoft Corporation (Azure)',
  'Alibaba Cloud',
  'Baseten, Inc.',
].map(host => `| ${host} | m | p | r | ${AI_HOST_LOCATION} |`)

describe('LUM-857 legal doc checks', () => {
  it('reads gateway host slugs from the manifest ZDR candidate column', () => {
    expect(zdrCandidateHosts(MANIFEST)).toEqual([
      'alibaba',
      'azure',
      'baseten',
      'openai',
    ])
  })

  it('splits a markdown table row into cells', () => {
    expect(tableCells('| a | b c |')).toEqual(['a', 'b c'])
  })

  it('passes a subprocessor list covering every service and manifest host', () => {
    expect(checkSubprocessors(subprocessorDoc(ALL_HOSTS), MANIFEST)).toEqual([])
  })

  it('flags a manifest host missing from the subprocessor list', () => {
    const gaps = checkSubprocessors(
      subprocessorDoc(ALL_HOSTS.slice(1)),
      MANIFEST
    )
    expect(gaps).toContain('LLM host missing from subprocessor tables: OpenAI')
  })

  it('flags a model author listed as a subprocessor', () => {
    const gaps = checkSubprocessors(
      subprocessorDoc([...ALL_HOSTS, '| DeepSeek | m | p | r | CN |']),
      MANIFEST
    )
    expect(gaps).toContain('DeepSeek listed as a subprocessor')
  })

  it('flags a manifest host with no name mapping', () => {
    const manifest = MANIFEST.replace('openai → azure', 'openai → newhost')
    expect(checkSubprocessors(subprocessorDoc(ALL_HOSTS), manifest)).toContain(
      'manifest host "newhost" has no name mapping — add it here'
    )
  })

  it('flags an AI host row that promises a data location', () => {
    const doc = subprocessorDoc([
      ...ALL_HOSTS.slice(1),
      '| OpenAI, L.L.C. | m | p | r | United States |',
    ])
    expect(checkAiHostLocations(doc)).toEqual([
      `AI host location is not "${AI_HOST_LOCATION}": OpenAI, L.L.C.`,
    ])
    expect(checkSubprocessors(doc, MANIFEST)).toContain(
      `AI host location is not "${AI_HOST_LOCATION}": OpenAI, L.L.C.`
    )
  })

  it('flags region wording the gateway region probe disproved', () => {
    expect(
      checkStaleRegionClaims(
        'The gateway does not report the region. | Not confirmed by the gateway |'
      )
    ).toEqual([
      'stale region claim: gateway "does not report/tell us" the region',
      'stale region claim: "not confirmed by the gateway" location',
    ])
    expect(checkStaleRegionClaims('AI requests are routed globally.')).toEqual(
      []
    )
  })

  it('reports each unmet requirement by label', () => {
    expect(
      checkRequirements('has Alpha', [
        ['alpha', /Alpha/],
        ['beta', /Beta/],
      ])
    ).toEqual(['missing: beta'])
  })

  it('finds the docId registered for a source file', () => {
    const readme =
      '| [legal-dpa-template.md](legal-dpa-template.md) | `cmabcdefghijklmnopqrstu` | [DPA](https://x) |'
    expect(
      registeredDocId(readme, 'docs/live-docs/legal-dpa-template.md')
    ).toBe('cmabcdefghijklmnopqrstu')
    expect(registeredDocId(readme, 'docs/live-docs/other.md')).toBeNull()
  })
})
