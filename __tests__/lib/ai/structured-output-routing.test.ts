import { structuredOutputProviderOptions } from '@/lib/ai/structured-output-routing'
import {
  FAST_MODEL,
  MEMORY_JUDGE_MODEL,
  STRUCTURED_OUTPUT_HOSTS,
} from '@/lib/ai/models'
import { AI_HOST_SUBPROCESSORS } from '@/lib/legal/subprocessors'

describe('LUM-1304 structured-output routing', () => {
  it('routes DeepSeek V4-Pro structured calls away from baseten, azure first', () => {
    expect(structuredOutputProviderOptions(MEMORY_JUDGE_MODEL)).toEqual({
      gateway: {
        order: ['azure', 'deepinfra', 'alibaba'],
        only: ['azure', 'deepinfra', 'alibaba'],
      },
    })
  })

  it('a model without an entry is routed as before', () => {
    expect(structuredOutputProviderOptions(FAST_MODEL)).toBeUndefined()
  })

  it('every listed host is an announced subprocessor', () => {
    const announced = new Set(AI_HOST_SUBPROCESSORS.map(s => s.gatewaySlug))
    for (const hosts of Object.values(STRUCTURED_OUTPUT_HOSTS))
      for (const h of hosts) expect(announced).toContain(h)
  })
})
