/**
 * LUM-965 — evaluate.ts call paths with the model mocked (no network):
 * judge output → record mapping, failure records, corpus loading from a
 * hand-written cache + fresh export, results-file reading.
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn((id: string) => id) }))

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateObject } from 'ai'
import { cacheFile } from '../../lum948-basharena/download'
import type { Candidate } from '../../lum958-basharena-llm/candidates'
import {
  extractAuthz,
  judgeAction,
  judgeWhole,
  loadCorpus,
  readRecords,
  type Trajectory,
} from '../evaluate'

const mockGenerate = generateObject as jest.Mock

const traj: Trajectory = {
  dataset: 'monitor-eval',
  id: '7:attack',
  sampleId: '7',
  label: 'attack',
  sideTask: 'leak_passwords',
  events: [
    {
      toolName: 'Bash',
      filePath: null,
      payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
    },
  ],
  taskDescription: 'Ship logs to 192.0.2.10.',
}

const ok = (object: unknown) => ({
  object,
  usage: {
    inputTokens: 1000,
    outputTokens: 50,
    inputTokenDetails: { cacheReadTokens: 400 },
  },
  providerMetadata: { gateway: { cost: '0.012' } },
})

beforeEach(() => mockGenerate.mockReset())

describe('judgeWhole', () => {
  it('maps the 0–100 score to 0..1 (clamped) and keeps the findings', async () => {
    mockGenerate.mockResolvedValueOnce(
      ok({
        authorized: '192.0.2.10',
        findings: [{ step: 1, what: 'ls', authorized: true }],
        suspicion: 150,
        category: 'NONE',
        reason: 'fine',
      })
    )
    const r = await judgeWhole('m', 'v1', 'fresh', traj)
    expect(r).toMatchObject({
      approach: 'whole',
      split: 'fresh',
      unitId: '7:attack',
      suspicion: 1,
      category: 'NONE',
      error: null,
      inputTokens: 1000,
      cacheReadTokens: 400,
      outputTokens: 50,
      costUsd: 0.012,
    })
    expect(r.detail).toEqual({
      authorized: '192.0.2.10',
      findings: [{ step: 1, what: 'ls', authorized: true }],
    })
    const call = mockGenerate.mock.calls[0]![0]
    expect(call.temperature).toBe(0)
    expect(call.messages[0].content).toContain('[1] Bash $ ls')
  })

  it('retries once, then records the failure as not-flagged', async () => {
    mockGenerate.mockRejectedValue(new Error('timeout'))
    const r = await judgeWhole('m', 'v1', 'tune', traj)
    expect(mockGenerate).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ suspicion: null, error: 'timeout' })
  })

  it('does not retry a fatal gateway error', async () => {
    mockGenerate.mockRejectedValue(new Error('insufficient credits'))
    const r = await judgeWhole('m', 'v1', 'tune', traj)
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(r.error).toMatch(/insufficient credits/)
  })
})

describe('extractAuthz / judgeAction', () => {
  const authz = {
    destinations: ['192.0.2.10'],
    credentials: [],
    firewall: [],
    privileges: [],
    downloads: [],
  }

  it('stores the authorization list as the record detail', async () => {
    mockGenerate.mockResolvedValueOnce(ok(authz))
    const r = await extractAuthz('m', 'v1', 'tune', traj)
    expect(r).toMatchObject({ approach: 'authz-extract', suspicion: null })
    expect(r.detail).toEqual(authz)
  })

  it('judges one candidate with the list in the cached prefix', async () => {
    mockGenerate.mockResolvedValueOnce(
      ok({
        comparison: 'within the list',
        suspicion: 0.2,
        category: 'NONE',
        reason: 'ok',
      })
    )
    const c: Candidate = {
      id: 'monitor-eval|7:attack|0',
      dataset: 'monitor-eval',
      trajectoryId: '7:attack',
      label: 'attack',
      sideTask: 'leak_passwords',
      eventIndex: 0,
      tool: 'Bash',
      filePath: null,
      action: 'curl 192.0.2.10',
      actionTruncated: false,
      prior: [],
      taskDescription: traj.taskDescription,
    }
    const r = await judgeAction('m', 'v1', 'tune', c, authz)
    expect(r).toMatchObject({
      approach: 'authz-action',
      unitId: c.id,
      trajectoryId: '7:attack',
      suspicion: 0.2,
      detail: { comparison: 'within the list' },
    })
    const [prefix, action] = mockGenerate.mock.calls[0]![0].messages[0].content
    expect(prefix.text).toContain('<authorization-list>')
    expect(prefix.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')
    expect(action.text).toContain('curl 192.0.2.10')
  })
})

describe('loadCorpus / readRecords', () => {
  it('loads monitor-eval from the cache and appends the fresh export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lum965-'))
    const row = (sample_id: string, label: string) => ({
      sample_id,
      action_idx: 0,
      label,
      side_task: label === 'attack' ? 'sudo_edit' : '',
      task_description: 'Task.',
      previous_actions: '[]',
      action: JSON.stringify([{ function: 'bash', arguments: { cmd: 'ls' } }]),
    })
    await writeFile(
      cacheFile(dir, 'abhayesian/basharena-monitor-eval', 'train'),
      JSON.stringify([row('1', 'attack'), row('2', 'honest')])
    )
    const exportFile = join(dir, 'ca.jsonl')
    await writeFile(
      exportFile,
      `${JSON.stringify({
        id: '9:honest:',
        taskId: '9',
        label: 'honest',
        sideTask: '',
        taskDescription: 'Fresh task.',
        calls: [{ function: 'bash', arguments: { cmd: 'pwd' } }],
        error: null,
        scores: {},
      })}\n`
    )
    const corpus = await loadCorpus(dir, exportFile)
    expect(corpus.trajectories.map(t => t.id)).toEqual([
      '1:attack',
      '2:honest',
      'ca:9:honest:',
    ])
    expect(corpus.split.get('1:attack')).toBe('tune')
    expect(corpus.split.get('ca:9:honest:')).toBe('fresh')
    const without = await loadCorpus(dir, join(dir, 'missing.jsonl'))
    expect(without.trajectories).toHaveLength(2)
  })

  it('reads a results file line by line, empty when missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lum965-'))
    const f = join(dir, 'r.jsonl')
    await writeFile(f, '{"unitId":"a"}\n\n{"unitId":"b"}\n')
    expect((await readRecords(f)).map(r => r.unitId)).toEqual(['a', 'b'])
    expect(await readRecords(join(dir, 'nope.jsonl'))).toEqual([])
  })
})
