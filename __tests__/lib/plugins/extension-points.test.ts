/**
 * @jest-environment node
 *
 * LUM-1061 — the registry and the core side of each server extension point,
 * driven by two fake plugins: registration order, merging, and isolation
 * (a plugin that throws on a best-effort surface contributes nothing; on a
 * fail-closed surface it makes the core throw).
 */
import type { LumoServerPlugin } from '@/lib/plugins/types'

const order: string[] = []
const register = jest.fn()

const alpha: LumoServerPlugin = {
  id: 'alpha',
  register(api) {
    register('alpha')
    api.doneGate({
      id: 'alpha',
      openBlockers: async () => [{ ruleId: 'a:1', filePath: 'a.ts' }],
    })
    api.agentContext({
      id: 'alpha',
      sessionStart: async () => '## Alpha',
      taskStatus: async () => ({
        nextActions: [{ kind: 'ALPHA' }],
        fields: { shared: 'alpha', alpha: 1 },
      }),
      preToolUseReminder: async () => 'ALPHA',
    })
    api.on('task.prLinked', p => void order.push(`alpha:${p.pullRequestId}`))
    api.retention({
      key: 'alpha',
      scrubRepositoryCode: async () => ({ scan: 2, finding: 3 }),
    })
  },
}

const beta: LumoServerPlugin = {
  id: 'beta',
  register(api) {
    register('beta')
    api.doneGate({
      id: 'beta',
      openBlockers: async () => [{ ruleId: 'b:1', filePath: 'b.ts' }],
    })
    api.agentContext({
      id: 'beta',
      sessionStart: async () => {
        throw new Error('beta down')
      },
      taskStatus: async () => {
        throw new Error('beta down')
      },
      // Not async: a synchronous throw must be isolated too.
      preToolUseReminder: () => {
        throw new Error('beta down')
      },
    })
    api.on('task.prLinked', () => {
      throw new Error('beta handler down')
    })
    api.on('task.prLinked', p => void order.push(`beta:${p.pullRequestId}`))
    api.retention({
      key: 'beta',
      scrubRepositoryCode: async () => ({ finding: 1, comment: 4 }),
    })
  },
}

jest.mock('@/lib/plugins/installed', () => ({
  get INSTALLED_SERVER_PLUGINS() {
    return [alpha, beta]
  },
}))

import { createPluginRegistry, getPluginRegistry } from '@/lib/plugins/registry'
import { collectDoneGateBlockers } from '@/lib/plugins/done-gate'
import {
  collectPreToolUseReminders,
  collectSessionStartSections,
  collectTaskStatusSections,
} from '@/lib/plugins/agent-context'
import { emitCoreEvent } from '@/lib/plugins/events'
import { scrubPluginRepositoryCode } from '@/lib/plugins/retention'
import { logger } from '@/lib/logger'

beforeEach(() => {
  order.length = 0
  jest.spyOn(logger, 'warn').mockImplementation(() => {})
  jest.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('registry', () => {
  it('registers every installed plugin once, lazily, in order', () => {
    expect(register).not.toHaveBeenCalled()
    const first = getPluginRegistry()
    expect(getPluginRegistry()).toBe(first)
    expect(register.mock.calls).toEqual([['alpha'], ['beta']])
    expect(first.plugins).toEqual(['alpha', 'beta'])
    expect(first.doneGates.map(g => g.id)).toEqual(['alpha', 'beta'])
    expect(first.handlersFor('task.prLinked')).toHaveLength(3)
    expect(first.handlersFor('github.push')).toEqual([])
  })

  it('refuses a plugin installed twice', () => {
    expect(() => createPluginRegistry([alpha, alpha])).toThrow(
      'plugin "alpha" is installed twice'
    )
  })
})

describe('done gate (fail-closed)', () => {
  it('concatenates blockers in registration order', async () => {
    await expect(collectDoneGateBlockers('t')).resolves.toEqual([
      { ruleId: 'a:1', filePath: 'a.ts' },
      { ruleId: 'b:1', filePath: 'b.ts' },
    ])
  })

  it('a contributor that throws makes the gate throw', async () => {
    const gate = getPluginRegistry().doneGates[1]!
    jest.spyOn(gate, 'openBlockers').mockRejectedValueOnce(new Error('db'))
    await expect(collectDoneGateBlockers('t')).rejects.toThrow('db')
  })
})

describe('agent context (best-effort)', () => {
  it('session-start keeps the sections that rendered', async () => {
    await expect(
      collectSessionStartSections({ taskId: 't', taskIdentifier: 'LUM-1' })
    ).resolves.toBe('## Alpha')
    expect(logger.warn).toHaveBeenCalledWith(
      'sessionStart.pluginSection.failed',
      expect.objectContaining({ plugin: 'beta', taskId: 't' })
    )
  })

  it('task status merges rows and fields, skipping a throwing plugin', async () => {
    await expect(collectTaskStatusSections('t')).resolves.toEqual({
      nextActions: [{ kind: 'ALPHA' }],
      fields: { shared: 'alpha', alpha: 1 },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'taskStatus.pluginSection.failed',
      expect.objectContaining({ plugin: 'beta', taskId: 't' })
    )
  })

  it('PreToolUse reminders are keyed <id>Reminder and isolated', async () => {
    await expect(
      collectPreToolUseReminders({ sessionId: null, taskId: 't' })
    ).resolves.toEqual({ alphaReminder: 'ALPHA' })
    expect(logger.error).toHaveBeenCalledWith(
      'pre-tool-use beta reminder error:',
      expect.any(Error)
    )
  })
})

describe('events (fire-and-forget)', () => {
  it('calls handlers synchronously in order; a throwing handler is logged and skipped', () => {
    emitCoreEvent('task.prLinked', { taskId: 't', pullRequestId: 'pr' })
    expect(order).toEqual(['alpha:pr', 'beta:pr'])
    expect(logger.error).toHaveBeenCalledWith(
      '[plugins] task.prLinked handler failed:',
      'beta handler down'
    )
  })
})

describe('retention', () => {
  it('sums scrub counts by noun across plugins', async () => {
    await expect(
      scrubPluginRepositoryCode({ workspaceId: 'w' })
    ).resolves.toEqual({ scan: 2, finding: 4, comment: 4 })
  })
})
