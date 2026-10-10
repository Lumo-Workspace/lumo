#!/usr/bin/env bash
# LUM-1065 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §6.1 item 2):
# prove the open-source snapshot of a ref builds and passes its tests ON ITS
# OWN — without the security plugin, the private evaluation set, or anything
# else the manifest keeps private.
#
#   bash scripts/oss-export/verify-snapshot.sh [<git-ref>] [--keep]
#
# Steps (each logged to <work>/logs/<step>.log, exit codes to summary.txt):
#   1. npm run oss:export -- <ref> <work>/snapshot   (fresh, empty dir)
#   2. git init + one commit inside the snapshot, with origin/main pointing at
#      it — as a fresh clone of the published repository looks (tests list
#      files with `git ls-files`, and a few diff against origin/main)
#   3. npm ci --ignore-scripts   — only after asserting the cwd is that fresh
#      snapshot under /private/tmp or /tmp, never a checkout or worktree
#   4. npx prisma generate · npm run build:shared
#   5. npx tsc --noEmit --incremental false · npx jest --ci
# The snapshot's node_modules is always removed at the end; the snapshot
# itself too unless --keep. Exit 0 only when every step exited 0.
#
# <work> is a new `mktemp -d` under $LUMO_OSS_VERIFY_TMP (default /private/tmp
# on macOS, /tmp elsewhere). The script never writes to the repository.
set -u -o pipefail

REF=HEAD
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) REF="$arg" ;;
  esac
done

REPO="$(git rev-parse --show-toplevel)" || exit 1
REPO="$(cd "$REPO" && pwd -P)" || exit 1
TMP_ROOT="${LUMO_OSS_VERIFY_TMP:-}"
if [ -z "$TMP_ROOT" ]; then
  if [ -d /private/tmp ]; then TMP_ROOT=/private/tmp; else TMP_ROOT=/tmp; fi
fi
WORK="$(mktemp -d "$TMP_ROOT/lumo-oss-verify.XXXXXX")" || exit 1
WORK="$(cd "$WORK" && pwd -P)" || exit 1
SNAP="$WORK/snapshot"
LOGS="$WORK/logs"
mkdir -p "$LOGS" || exit 1
SUMMARY="$LOGS/summary.txt"

say() { echo "$*" | tee -a "$SUMMARY"; }
cleanup() {
  # Only ever inside $WORK, which this run created.
  case "$SNAP" in "$WORK"/snapshot) ;; *) return ;; esac
  rm -rf "$SNAP/node_modules"
  if [ "$KEEP" = 0 ]; then rm -rf "$SNAP"; fi
}
trap cleanup EXIT

# The work dir must be a temp dir outside the repository.
case "$WORK/" in
  /private/tmp/* | /tmp/*) ;;
  *) say "ABORT: work dir $WORK is not under /private/tmp or /tmp"; exit 1 ;;
esac
case "$WORK/" in
  "$REPO"/*) say "ABORT: work dir $WORK is inside the repository"; exit 1 ;;
esac

cd "$REPO" || exit 1
SHA="$(git rev-parse --verify "$REF^{commit}")" || exit 1
say "ref $REF = $SHA"
say "work $WORK"

# 1. Export (the export itself refuses a non-empty out dir).
npx tsx scripts/oss-export.ts "$SHA" "$SNAP" >"$LOGS/export.log" 2>&1
rc=$?
say "export exit=$rc"
grep -E '^(✓|  tracked|  checks)' "$LOGS/export.log" | tee -a "$SUMMARY"
[ "$rc" = 0 ] || { say "ABORT: export failed (see $LOGS/export.log)"; exit 1; }

# 2–3. Everything below runs INSIDE the fresh snapshot only.
cd "$SNAP" || exit 1
HERE="$(pwd -P)"
if [ "$HERE" != "$SNAP" ] || [ -e .git ] || [ -e node_modules ] ||
  [ ! -f package.json ] || [ -e ee ] || [ -e oss ]; then
  say "ABORT: $HERE is not the fresh snapshot this run exported"
  exit 1
fi
case "$HERE/" in
  "$REPO"/*) say "ABORT: $HERE is inside the repository"; exit 1 ;;
esac

git init -q >"$LOGS/git-init.log" 2>&1 &&
  git add -A >>"$LOGS/git-init.log" 2>&1 &&
  git -c user.name=oss-verify -c user.email=oss-verify@localhost \
    -c commit.gpgsign=false commit -q -m "snapshot of $SHA" \
    >>"$LOGS/git-init.log" 2>&1 &&
  git update-ref refs/remotes/origin/main HEAD >>"$LOGS/git-init.log" 2>&1
rc=$?
say "git-init exit=$rc"
[ "$rc" = 0 ] || exit 1

[ "$(pwd -P)" = "$SNAP" ] || { say "ABORT: cwd moved"; exit 1; }
npm ci --ignore-scripts --no-audit --no-fund >"$LOGS/npm-ci.log" 2>&1
rc=$?
say "npm-ci exit=$rc"
[ "$rc" = 0 ] || exit 1

FAILED=0
step() {
  local name="$1"
  shift
  [ "$(pwd -P)" = "$SNAP" ] || { say "ABORT: cwd moved"; exit 1; }
  "$@" >"$LOGS/$name.log" 2>&1
  local code=$?
  say "$name exit=$code"
  [ "$code" = 0 ] || FAILED=1
  return "$code"
}

# The snapshot has no .env: give prisma.config.ts a placeholder URL so
# `prisma generate` (which never connects) can load its config.
export DATABASE_URL="${DATABASE_URL:-postgresql://oss:oss@localhost:5432/oss}"
step prisma-generate npx prisma generate || exit 1
step build-shared npm run build:shared || exit 1
step tsc npx tsc --noEmit --incremental false
step jest npx jest --ci
grep -E '^(Test Suites|Tests):' "$LOGS/jest.log" | tee -a "$SUMMARY"

if [ "$FAILED" = 0 ]; then say "OK: snapshot of $SHA builds and passes"; fi
say "logs: $LOGS"
exit "$FAILED"
