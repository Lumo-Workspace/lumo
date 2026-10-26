import { isMemoryPipelineDisabled } from '@/lib/memory/pipeline-switch'

describe('isMemoryPipelineDisabled (LUM-1314)', () => {
  afterEach(() => {
    delete process.env.MEMORY_PIPELINE_DISABLED
  })

  it('is off when the env is unset', () => {
    delete process.env.MEMORY_PIPELINE_DISABLED
    expect(isMemoryPipelineDisabled()).toBe(false)
  })

  it.each(['1', 'true', 'TRUE', ' true '])('is on for %p', v => {
    process.env.MEMORY_PIPELINE_DISABLED = v
    expect(isMemoryPipelineDisabled()).toBe(true)
  })

  it.each(['', '0', 'false', 'no'])('is off for %p', v => {
    process.env.MEMORY_PIPELINE_DISABLED = v
    expect(isMemoryPipelineDisabled()).toBe(false)
  })
})
