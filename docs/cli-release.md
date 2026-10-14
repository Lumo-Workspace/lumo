# Releasing `@lumoai/cli`

The CLI, the bundled `lumo` skill (`.claude/skills/lumo` → `cli/skills/lumo`) and the hook commands all ship in the one npm package, so one release carries all three. There is no CI publish: a maintainer runs the release locally and types the npm OTP.

The version is bumped **once per release**, not per PR (LUM-1119): ordinary PRs that change the CLI leave `cli/package.json` alone. The release script makes the bump in its own release PR, so parallel CLI PRs no longer collide on version numbers.

A release is two runs of `npm run release:cli`, with a merge and a production deploy in between. You must pick the mode: the script never guesses a bump level.

## Steps

1. **Open the release PR.** From any clean checkout:

   ```bash
   npm run release:cli -- --bump <patch|minor|major> --dry-run   # preview
   npm run release:cli -- --bump <patch|minor|major>
   ```

   The script fetches `origin/main`. The new version is the level applied to the higher of npm's highest published version and `main`'s version, so it is always above both. The script then:
   - creates `lumo/release-cli-v<new>` from `origin/main` and switches to it;
   - writes the version into `cli/package.json` and `package-lock.json` (`packages.cli`), then regenerates `scripts/cli-grammar/grammar.json` (`emit-grammar`);
   - checks the three files agree (the LUM-1104 parity test checks the same thing);
   - commits `chore: release CLI v<new> [skip-drift]`, pushes, and runs `gh pr create`. The PR body has the release steps and a changelog draft.

   Then it stops. It never merges the PR. If a step fails, the error says what was already done, for example "branch pushed, PR not opened".

2. **Merge the PR** and wait until production is deployed from a commit that contains it.

3. **Release** from a clean, up-to-date `main` (`git switch main && git pull`):

   ```bash
   npm run release:cli -- --version <new> --dry-run
   npm run release:cli -- --version <new>
   cd cli && npm publish          # asks for your OTP; prepublishOnly rebuilds dist + skills
   git push origin cli-v<new>
   ```

   If `npm publish` fails, delete the local tag (`git tag -d cli-v<new>`), fix the problem and run the release again.

If `main` already carries a version that is above npm's latest and not published yet, skip step 1 and run step 3 with that version. `--bump` prints a note when this is the case.

## What the script checks

This table covers `--version` runs. A real run stops at the first failure. `--dry-run` runs every check, prints the changelog, and exits 1 if any check failed. A `--bump --dry-run` prints the planned branch, commit and PR body and changes nothing.

| Step      | Passes when                                                                                                                    | Fails closed when                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| git       | on `main`, working tree clean, `HEAD` equals `origin/main` (after `git fetch`)                                                 | —                                                     |
| deploy    | the deployment currently serving production on Vercel was built from `HEAD` or a later commit                                  | the Vercel API cannot be read (`vercel login` / link) |
| npm       | `cli/package.json` at `HEAD` equals `--version`, is above every published version, and the `cli-v<version>` tag does not exist | `npm view` fails                                      |
| changelog | a previous release is found (see below)                                                                                        | none found: pass `--since <ref>`                      |
| tag       | creates the annotated tag `cli-v<version>` locally; its message is the changelog                                               | —                                                     |

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
