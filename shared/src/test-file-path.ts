/**
 * What counts as a test file / test tree. Single-sourced here (LUM-779)
 * because several sides must agree on it: the server's TEST_FILE_DELETED
 * command matcher (lib/services/boundary-detector.service.ts), the CLI's
 * local-git probe (cli/src/lib/git-deleted-test-files.ts) that reports which
 * tracked test files are actually missing, the PR re-judge
 * (lib/boundary-crossing/rejudge-cause.ts), and the used-up ingest strip
 * (lib/hook-payload/redact.ts), which keeps test-file edits for
 * TEST_TAMPERING review. A pattern that drifted between them would let a real
 * deletion slip through as "nothing missing" — so there is exactly one.
 *
 * LUM-873 tightened it: `.test.` / `.spec.` count only before a source-code
 * extension (so `openapi.spec.yaml`, `.env.test.local` and
 * `foo.test.config.js` are not tests), and the per-language conventions are
 * covered — Go `_test.go`, Python `test_*.py` / `*_test.py`, Ruby
 * `*_spec.rb` / `*_test.rb` — plus anything under a `__tests__/`, `tests/`,
 * `test/` or `spec/` directory (or that directory itself, for `rm -rf tests`).
 *
 * The pattern also runs on shell tokens, which may carry a closing quote or
 * operator, so the end of a name is "end of string or a shell delimiter".
 */
const CODE_EXT =
  '(?:[cm]?[jt]sx?|py|go|rb|java|kts?|rs|swift|cs|php|scala|exs?|dart|c|cc|cpp|vue|svelte)'
const END = `(?=$|[\\s"'\`;|&)])`
const START = `(?:^|[\\/\\s"'=])`

export const TEST_FILE_TARGET = new RegExp(
  [
    `\\.(?:test|spec)\\.${CODE_EXT}${END}`,
    `_test\\.(?:go|py|rb)${END}`,
    `_spec\\.rb${END}`,
    `${START}test_[^\\/\\s"'\`;|&)]*\\.py${END}`,
    `${START}(?:__tests__|tests?|spec)(?:\\/|${END})`,
  ].join('|')
)

export function isTestFilePath(path: string): boolean {
  return TEST_FILE_TARGET.test(path)
}
