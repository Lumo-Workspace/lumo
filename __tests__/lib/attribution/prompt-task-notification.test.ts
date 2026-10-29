/**
 * LUM-1302 — `HookEvent.promptTaskNotification`, decided at record time.
 */
import { promptCarriesTaskNotification } from '@/lib/attribution/signals'

describe('promptCarriesTaskNotification', () => {
  const notice = '<task-notification><task-id>a1</task-id></task-notification>'

  it('is true for a root prompt carrying a task notification', () => {
    expect(
      promptCarriesTaskNotification('USER_PROMPT_SUBMIT', {
        prompt: `x ${notice}`,
      })
    ).toBe(true)
  })

  it('is false for other prompts and other event types', () => {
    expect(
      promptCarriesTaskNotification('USER_PROMPT_SUBMIT', { prompt: 'fix it' })
    ).toBe(false)
    expect(promptCarriesTaskNotification('STOP', { prompt: notice })).toBe(
      false
    )
    expect(promptCarriesTaskNotification('USER_PROMPT_SUBMIT', null)).toBe(
      false
    )
  })
})
