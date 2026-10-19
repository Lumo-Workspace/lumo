/**
 * LUM-1265: helpers for driving the shadcn/Radix Select in jsdom.
 *
 * Radix Select is a button (role=combobox) plus a portalled listbox, so
 * `userEvent.selectOptions` and `select.value` no longer apply. Tests open
 * the trigger and click the option by its visible name instead.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** jsdom lacks the DOM APIs Radix Select calls while opening. Call once per file. */
export function installRadixSelectShims(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.scrollIntoView ??= () => {}
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => {}
  proto.setPointerCapture ??= () => {}
}

/** Opens a Radix Select and picks the option with this accessible name. */
export async function pickOption(
  trigger: HTMLElement,
  name: string | RegExp
): Promise<void> {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name }))
}

/** The visible names of a Radix Select's options (opens, reads, closes). */
export async function optionNames(trigger: HTMLElement): Promise<string[]> {
  await userEvent.click(trigger)
  const names = (await screen.findAllByRole('option')).map(
    o => o.textContent ?? ''
  )
  await userEvent.keyboard('{Escape}')
  return names
}
