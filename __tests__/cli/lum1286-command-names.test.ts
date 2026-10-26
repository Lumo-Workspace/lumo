/** @jest-environment node */
// LUM-1286: the confirm / dismiss commands named in session context.
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
} from '@/lib/cli/command-names'

it('names the dependency confirm / dismiss commands for the caller CLI', () => {
  expect(CURRENT_CLI_COMMANDS.taskDepConfirm('LUM-50', 'LUM-2')).toBe(
    'lumo task dep confirm LUM-50 LUM-2'
  )
  expect(CURRENT_CLI_COMMANDS.taskDepDismiss('LUM-50', 'LUM-2')).toBe(
    'lumo task dep dismiss LUM-50 LUM-2'
  )
  expect(LEGACY_CLI_COMMANDS.taskDepConfirm('LUM-50', 'LUM-2')).toBe(
    'lumo task deps confirm LUM-50 LUM-2'
  )
  expect(LEGACY_CLI_COMMANDS.taskDepDismiss('LUM-50', 'LUM-2')).toBe(
    'lumo task deps dismiss LUM-50 LUM-2'
  )
})
