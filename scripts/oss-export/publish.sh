#!/usr/bin/env bash
# LUM-1035: DRY RUN of a release to the public repository Lumo-Workspace/lumo-oss
# (runbook: docs/open-source/release-and-sync.md).
#
#   bash scripts/oss-export/publish.sh <git-ref> --version <vX.Y.Z> \
#     [--public-clone <dir>] [--skip-verify]
#
# It prepares and checks everything a release needs, then PRINTS the commands a
# maintainer runs to publish. It never pushes, tags, creates a repository or
# calls the GitHub API — no `git push`, no `git tag`, no `gh`. It is not
# offline: step 2 installs the snapshot's dependencies from the npm registry
# (`npm ci` inside verify-snapshot.sh; `--skip-verify` skips it). Steps:
#   1. export the snapshot of <git-ref> into a new temp dir (kept for review)
#   2. bash scripts/oss-export/verify-snapshot.sh <git-ref> (unless --skip-verify)
#   3. secret scan: python3 scripts/audit-secrets.py snapshot --ref <sha>, only
#      when Gitleaks 8.30.1 is already installed (the script never downloads it)
#   4. the snapshot has README/LICENSE/CONTRIBUTING/SECURITY and the DCO
#      workflow, and none of the private paths (ee/, oss/, this runbook)
#   5. with --public-clone (a local clone of the public repo, read only): what
#      the release changes there, and every public commit since the last
#      release must already be back-ported (else the snapshot would revert it)
#   6. print the publish commands
# Exit: 0 every gate passed · 3 every gate that ran passed but the secret scan
# did not run (Gitleaks missing) · 1 a gate failed · 2 usage error.
set -u -o pipefail

REF=""
VERSION=""
PUBLIC=""
SKIP_VERIFY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --public-clone) PUBLIC="${2:-}"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) REF="$1"; shift ;;
  esac
done
if [ -z "$REF" ] || ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "usage: publish.sh <git-ref> --version vX.Y.Z [--public-clone <dir>] [--skip-verify]" >&2
  exit 2
fi

PUBLIC_REPO="Lumo-Workspace/lumo-oss"
GITLEAKS_VERSION="8.30.1"

REPO="$(git rev-parse --show-toplevel)" || exit 1
REPO="$(cd "$REPO" && pwd -P)" || exit 1
cd "$REPO" || exit 1
SHA="$(git rev-parse --verify "$REF^{commit}")" || exit 1

TMP_ROOT="${LUMO_OSS_VERIFY_TMP:-}"
if [ -z "$TMP_ROOT" ]; then
  if [ -d /private/tmp ]; then TMP_ROOT=/private/tmp; else TMP_ROOT=/tmp; fi
fi
WORK="$(mktemp -d "$TMP_ROOT/lumo-oss-publish.XXXXXX")" || exit 1
WORK="$(cd "$WORK" && pwd -P)" || exit 1
case "$WORK/" in
  "$REPO"/*) echo "ABORT: work dir $WORK is inside the repository" >&2; exit 1 ;;
esac
SNAP="$WORK/snapshot"
LOGS="$WORK/logs"
mkdir -p "$LOGS" || exit 1
SUMMARY="$LOGS/summary.txt"

say() { echo "$*" | tee -a "$SUMMARY"; }
FAILED=0
PENDING=0
gate() { # gate <name> <ok|skip|fail|pending> <detail>
  say "[$2] $1 — $3"
  case "$2" in fail) FAILED=1 ;; pending) PENDING=1 ;; esac
}

say "DRY RUN — nothing is pushed, tagged or created"
say "ref $REF = $SHA · version $VERSION · work $WORK"

# 1. Export (refuses a non-empty out dir; checks unclassified files, imports,
#    config references and forbidden markers).
npx tsx scripts/oss-export.ts "$SHA" "$SNAP" >"$LOGS/export.log" 2>&1
rc=$?
if [ "$rc" = 0 ]; then
  gate export ok "$(grep -E '^  tracked' "$LOGS/export.log" | sed 's/^ *//')"
else
  gate export fail "exit $rc, see $LOGS/export.log"
  say "NOT READY"
  exit 1
fi

# 2. The snapshot builds and passes its own tests.
if [ "$SKIP_VERIFY" = 1 ]; then
  gate verify-snapshot pending "skipped (--skip-verify); run it before publishing"
else
  bash scripts/oss-export/verify-snapshot.sh "$SHA" >"$LOGS/verify.log" 2>&1
  rc=$?
  if [ "$rc" = 0 ]; then
    gate verify-snapshot ok "$(grep -E '^(Tests:|OK:)' "$LOGS/verify.log" | tr '\n' ' ')"
  else
    gate verify-snapshot fail "exit $rc, see $LOGS/verify.log"
  fi
fi

# 3. Secret scan of the release commit — only with an already-installed
#    Gitleaks of the pinned version. Never downloads anything.
if command -v gitleaks >/dev/null 2>&1 &&
  gitleaks version 2>/dev/null | grep -q "$GITLEAKS_VERSION"; then
  python3 scripts/audit-secrets.py snapshot --ref "$SHA" >"$LOGS/secrets.log" 2>&1
  rc=$?
  if [ "$rc" = 0 ]; then
    gate secret-scan ok "audit-secrets.py snapshot: zero unhandled findings"
  else
    gate secret-scan fail "exit $rc, see $LOGS/secrets.log"
  fi
else
  gate secret-scan pending "Gitleaks $GITLEAKS_VERSION is not installed; installing it needs the user's approval (docs/open-source/secret-scan.md)"
fi

# 4. Public-repository files present, private paths absent.
missing=""
for f in README.md LICENSE CONTRIBUTING.md SECURITY.md CLAUDE.md \
  .github/workflows/dco.yml .github/workflows/images.yml \
  .github/scripts/check-dco.mjs; do
  [ -f "$SNAP/$f" ] || missing="$missing $f"
done
leaked=""
for f in ee oss scripts/oss-export scripts/oss-export.ts \
  docs/open-source/release-and-sync.md docs/rfc .env .env.local; do
  [ -e "$SNAP/$f" ] && leaked="$leaked $f"
done
if [ -z "$missing$leaked" ]; then
  gate snapshot-files ok "public files present; no private path"
else
  gate snapshot-files fail "missing:${missing:- none} · private:${leaked:- none}"
fi

# 5. Against a local clone of the public repository (read only).
if [ -n "$PUBLIC" ]; then
  PUBLIC="$(cd "$PUBLIC" && pwd -P)" || exit 1
  if ! git -C "$PUBLIC" rev-parse --verify -q HEAD >/dev/null; then
    gate public-clone fail "$PUBLIC is not a git clone with commits"
  else
    # What the release changes in the public tree.
    git -C "$PUBLIC" ls-files | sort >"$LOGS/public-files.txt"
    (cd "$SNAP" && find . -type f ! -path './.git/*' | sed 's#^\./##' | sort) >"$LOGS/snapshot-files.txt"
    added=$(comm -13 "$LOGS/public-files.txt" "$LOGS/snapshot-files.txt" | wc -l | tr -d ' ')
    removed=$(comm -23 "$LOGS/public-files.txt" "$LOGS/snapshot-files.txt" | wc -l | tr -d ' ')
    changed=0
    while IFS= read -r f; do
      cmp -s "$PUBLIC/$f" "$SNAP/$f" || changed=$((changed + 1))
    done < <(comm -12 "$LOGS/public-files.txt" "$LOGS/snapshot-files.txt")
    comm -23 "$LOGS/public-files.txt" "$LOGS/snapshot-files.txt" >"$LOGS/removed-files.txt"
    gate public-diff ok "release adds $added, removes $removed, changes $changed file(s); removed list: $LOGS/removed-files.txt"

    # Every public commit since the last release must be back-ported, or the
    # snapshot (cut from the private repo) would silently revert it.
    LAST_TAG="$(git -C "$PUBLIC" describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
    RANGE="${LAST_TAG:+$LAST_TAG..}HEAD"
    unported=""
    while IFS= read -r c; do
      [ -n "$c" ] || continue
      # Release commits carry the Lumo-Release trailer; skip them.
      git -C "$PUBLIC" log -1 --format=%B "$c" | grep -q '^Lumo-Release: ' && continue
      git log --format=%H --grep="^Upstream-Commit: $PUBLIC_REPO@$c" "$SHA" | grep -q . ||
        unported="$unported ${c:0:12}"
    done < <(git -C "$PUBLIC" rev-list --no-merges "$RANGE")
    if [ -z "$unported" ]; then
      gate back-ports ok "every public commit in ${RANGE} is back-ported (or a release commit)"
    else
      gate back-ports fail "not back-ported into $REF:$unported — back-port them first (runbook §4)"
    fi
  fi
else
  # Only the first release has no public clone to compare against.
  gate public-clone skip "no --public-clone: release diff and back-port check skipped — required for every release after the first"
fi

# 6. What a maintainer runs to publish — printed, never executed.
cat <<EOF | tee -a "$SUMMARY"

---- publish commands (run by a maintainer with push rights; NOT executed) ----
# First release (empty repository created on GitHub, see runbook §2):
#   cd "$SNAP" && git init -b main && git add -A
#   git commit -s -m "release: $VERSION" -m "Lumo-Release: $VERSION"
#   git remote add origin git@github.com:$PUBLIC_REPO.git
#   git push -u origin main
#   git tag -a $VERSION -m "Lumo $VERSION" && git push origin $VERSION
# Later releases (in an up-to-date clone of the public repository, runbook §3):
#   rsync -a --delete --exclude .git "$SNAP"/ <public-clone>/
#   cd <public-clone> && git add -A
#   git commit -s -m "release: $VERSION" -m "Lumo-Release: $VERSION"
#   git push origin main     # through a pull request if main is protected
#   git tag -a $VERSION -m "Lumo $VERSION" && git push origin $VERSION
EOF

say ""
say "snapshot kept for review: $SNAP"
say "logs: $LOGS"
if [ "$FAILED" = 1 ]; then
  say "NOT READY: a gate failed"
  exit 1
fi
if [ "$PENDING" = 1 ]; then
  say "NOT READY YET: every gate that ran passed; pending gates above"
  exit 3
fi
say "READY: every gate passed"
exit 0
