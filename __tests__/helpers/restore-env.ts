/**
 * Put an env var back as it was: an unset one is deleted, not assigned —
 * `process.env.X = undefined` stores the string "undefined".
 */
export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
