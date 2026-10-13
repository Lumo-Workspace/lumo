# Releasing `@lumoai/cli`

The CLI, the bundled `lumo` skill (`.claude/skills/lumo` → `cli/skills/lumo`) and the hook commands all ship in the one npm package, so one release carries all three. There is no CI publish: a maintainer runs the release locally and types the npm OTP.

Version bumps are unchanged: every PR that changes the CLI bumps `cli/package.json` itself (kept in step with `package-lock.json` and `grammar.json` by the parity test). The release script never bumps.

## Steps

1. Get a clean, up-to-date `main` checkout (`git pull` on `main`).
2. Preview, without tagging:

   ```bash
   npm run release:cli -- --dry-run
   ```

3. Release:

   ```bash
   npm run release:cli
   cd cli && npm publish          # asks for your OTP; prepublishOnly rebuilds dist + skills
   git push origin cli-v<version>
   ```

   If `npm publish` fails, delete the local tag (`git tag -d cli-v<version>`), fix the problem and run the release again.

## What the script checks

A real run stops at the first failure. `--dry-run` runs every check, prints the changelog, and exits 1 if any check failed.

| Step      | Passes when                                                                                   | Fails closed when                                     |
| --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| git       | on `main`, working tree clean, `HEAD` equals `origin/main` (after `git fetch`)                | —                                                     |
| deploy    | the deployment currently serving production on Vercel was built from `HEAD` or a later commit | the Vercel API cannot be read (`vercel login` / link) |
| npm       | the version in `cli/package.json` is not on npm and the `cli-v<version>` tag does not exist   | `npm view` fails                                      |
| changelog | a previous release is found (see below)                                                       | none found: pass `--since <ref>`                      |
| tag       | creates the annotated tag `cli-v<version>` locally; its message is the changelog              | —                                                     |

The deploy check matters because new commands call new server APIs; a CLI published before the server is deployed gets 404s.

The Vercel project is read from `VERCEL_PROJECT_ID` + `VERCEL_ORG_ID`, or from `.vercel/project.json` (`vercel link`). The Vercel and npm calls are read-only, and the script does not print or store credentials.

## Changelog

The changelog covers changes since the last release. That is the newest `cli-v*` tag that is older than the version being released and reachable from `HEAD`. Before the first tag exists, it is the first commit at npm's latest published version. `--since <ref>` overrides both.

| Section  | Source                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Commands | `scripts/cli-grammar/grammar.json` diff: added/removed commands and flags, changed flag values                      |
| Hooks    | `lumo hook …` commands from the same diff, the event lists in `cli/src/lib/hooks-template.ts`, changed hook sources |
| Skill    | files changed under `.claude/skills/lumo/`                                                                          |
| Commits  | `git log` of `cli/`, `.claude/skills/lumo/` and `grammar.json`                                                      |

Add `--changelog-out <file>` to also write it to a file. `--no-fetch` skips `git fetch`.
