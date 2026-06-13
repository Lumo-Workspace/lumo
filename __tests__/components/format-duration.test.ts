import { formatDuration } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/format-duration'

describe('formatDuration', () => {
  it('renders sub-second as ms', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(999)).toBe('999ms')
  })
  it('renders under a minute as seconds', () => {
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(59_000)).toBe('59s')
  })
  it('renders whole minutes without a seconds part', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(120_000)).toBe('2m')
  })
  it('renders minutes and seconds', () => {
    expect(formatDuration(17_692_000)).toBe('294m 52s')
  })
})
