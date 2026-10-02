/**
 * @jest-environment node
 *
 * LUM-932 acceptance #4: subagent usage is split out of the parent session and
 * never double counted.
 */
import {
  parseInjectedUsage,
  splitSubagentUsage,
  usageTotal,
} from '@/lib/session/subagent-usage'

const m = (input: number, output: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheCreation: 0,
})

const payload = {
  _lumo_usage: {
    inputTokens: 300,
    outputTokens: 30,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    byModel: { opus: m(200, 20), sonnet: m(100, 10) },
    bySubagent: {
      abeaba01ea909a7ee: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        byModel: { sonnet: m(100, 10) },
      },
    },
  },
}

describe('splits subagent usage out of the parent without double counting', () => {
  it('parses bySubagent and leaves it absent for old CLIs', () => {
    const u = parseInjectedUsage(payload)!
    expect(u.bySubagent?.abeaba01ea909a7ee?.inputTokens).toBe(100)
    const old = parseInjectedUsage({
      _lumo_usage: { ...payload._lumo_usage, bySubagent: undefined },
    })!
    expect(old.bySubagent).toBeUndefined()
  })

  it('main excludes every subagent and main + subagents equals the total', () => {
    const u = parseInjectedUsage(payload)!
    const { main, bySubagent } = splitSubagentUsage(u)
    expect(main.inputTokens).toBe(200)
    expect(main.byModel).toEqual({ opus: m(200, 20), sonnet: m(0, 0) })
    const sum =
      usageTotal(main) +
      Object.values(bySubagent).reduce((s, x) => s + usageTotal(x), 0)
    expect(sum).toBe(usageTotal(u))
  })

  it('is a no-op split when there is no bySubagent', () => {
    const u = parseInjectedUsage({
      _lumo_usage: { ...payload._lumo_usage, bySubagent: undefined },
    })!
    const { main, bySubagent } = splitSubagentUsage(u)
    expect(main).toEqual(u)
    expect(bySubagent).toEqual({})
  })

  it('drops subagent keys that are not valid agent ids', () => {
    const u = parseInjectedUsage({
      _lumo_usage: {
        ...payload._lumo_usage,
        bySubagent: {
          'bad id;': payload._lumo_usage.bySubagent.abeaba01ea909a7ee,
        },
      },
    })!
    expect(u.bySubagent).toEqual({})
  })
})
