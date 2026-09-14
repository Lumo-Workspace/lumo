/**
 * What counts as a test file / test tree for the TEST_FILE_DELETED session
 * guard (LUM-736): `*.test.*`, `*.spec.*`, or anything under a `__tests__/`
 * segment. Single-sourced here (LUM-779) because two sides must agree on it:
 * the server's command matcher (lib/services/boundary-detector.service.ts)
 * and the CLI's local-git probe (cli/src/lib/git-deleted-test-files.ts) that
 * reports which tracked test files are actually missing. A pattern that
 * drifted between the two would let a real deletion slip through as "nothing
 * missing" — so there is exactly one pattern.
 */
export const TEST_FILE_TARGET =
  /(?:\.(?:test|spec)\.|(?:^|\/)__tests__(?:\/|$))/

export function isTestFilePath(path: string): boolean {
  return TEST_FILE_TARGET.test(path)
}
