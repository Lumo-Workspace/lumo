/** @jest-environment node */
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(),
}))

import {
  collectDiffGraphInputs,
  toGraphRuleRows,
  graphRuleFingerprint,
  GRAPH_RULE_MAX_READS,
} from '@/lib/services/security-graph-rules.service'
import { SUBGRAPH_MAX_FILES } from '@/lib/security-scan/graph/types'
import type { LlmOutputFlow } from '@/lib/security-scan/graph/llm-output-flow'

const job = {
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'sha',
  touchedSourcePaths: [] as string[],
}

describe('LUM-785 graph rules service', () => {
  it('reads touched TS files, then one hop of resolvable imports, trying candidates in order and skipping bare packages', async () => {
    const files: Record<string, string> = {
      'app/api/x/route.ts': `import { a } from '@/lib/a'\nimport { b } from './b'\nimport { z } from 'zod'\nexport function GET() { return a() + b() }\n`,
      'lib/a/index.ts': 'export const a = () => 1\n',
      'app/api/x/b.tsx': 'export const b = () => 2\n',
    }
    const read = jest.fn(async (p: string) => files[p] ?? null)
    const { inputs, capped } = await collectDiffGraphInputs(
      {
        ...job,
        touchedSourcePaths: [
          'app/api/x/route.ts',
          'docs/readme.md',
          '../etc/passwd.ts',
        ],
      },
      read
    )
    expect(capped).toBe(false)
    expect(inputs.map(i => [i.path, i.touched])).toEqual([
      ['app/api/x/route.ts', true],
      ['lib/a/index.ts', false],
      ['app/api/x/b.tsx', false],
    ])
    // `@/lib/a` → a.ts, a.tsx, a/index.ts (found); `./b` → b.ts (miss), b.tsx (hit).
    expect(read.mock.calls.map(c => c[0])).toEqual([
      'app/api/x/route.ts',
      'lib/a.ts',
      'lib/a.tsx',
      'lib/a/index.ts',
      'app/api/x/b.ts',
      'app/api/x/b.tsx',
    ])
  })

  it('caps files at SUBGRAPH_MAX_FILES and reads at GRAPH_RULE_MAX_READS, reporting capped (not partial)', async () => {
    const touched = Array.from(
      { length: SUBGRAPH_MAX_FILES + 5 },
      (_, i) => `lib/f${i}.ts`
    )
    const read = jest.fn(async () => 'export const x = 1\n')
    const { inputs, capped } = await collectDiffGraphInputs(
      { ...job, touchedSourcePaths: touched },
      read
    )
    expect(inputs).toHaveLength(SUBGRAPH_MAX_FILES)
    expect(capped).toBe(true)
    expect(GRAPH_RULE_MAX_READS).toBeGreaterThan(SUBGRAPH_MAX_FILES)
  })

  it('turns a flow into a DETERMINISTIC row with the sink meta, chain evidence and a stable fingerprint', () => {
    const flow: LlmOutputFlow = {
      source: {
        symbol: 'a.ts#POST',
        file: 'a.ts',
        line: 3,
        callee: 'generateText',
      },
      sink: {
        symbol: 'b.ts#execSync@9',
        file: 'b.ts',
        line: 9,
        callee: 'execSync',
        rule: 'child-process',
      },
      chain: ['a.ts#POST', 'b.ts#run'],
      reachability: 'INTERNAL',
    }
    const [row] = toGraphRuleRows('s1', [flow])
    expect(row).toMatchObject({
      scanId: 's1',
      kind: 'VULNERABILITY',
      ruleId: 'llm-output-to-sink:child-process',
      severity: 'HIGH',
      provenance: 'DETERMINISTIC',
      filePath: 'b.ts',
      line: 9,
      cwe: 'CWE-78',
      reachability: 'INTERNAL',
      evidence: 'a.ts#POST → b.ts#run → b.ts#execSync@9',
      callChain: [
        { from: 'a.ts#POST', to: 'b.ts#run' },
        { from: 'b.ts#run', to: 'b.ts#execSync@9' },
      ],
      fingerprint: graphRuleFingerprint('b.ts#execSync@9', 'a.ts#POST'),
    })
    expect(row!.falsifierVerdict).toBeUndefined()
    expect(row!.detail).toContain('1 call hop')
    expect(graphRuleFingerprint('x', 'y')).toMatch(/^[0-9a-f]{16}$/)
    expect(graphRuleFingerprint('x', 'y')).not.toBe(
      graphRuleFingerprint('y', 'x')
    )
  })
})
