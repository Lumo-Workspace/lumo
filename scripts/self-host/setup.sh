#!/bin/sh
# LUM-1325, LUM-1332, LUM-1335 — prepare .env for `docker compose up -d` (self-hosting).
#
#   scripts/self-host/setup.sh [--url https://lumo.example.com] [--realtime | --no-realtime]
#                              [--caddy | --no-caddy] [--local | --no-local]
#                              [--no-start | --check]
#
# - Copies .env.example to .env when .env does not exist yet.
# - Fills every secret the stack needs with `openssl rand -hex 32`. A secret
#   that already has a value is never replaced: rotating BETTER_AUTH_SECRET
#   signs everybody out, and POSTGRES_PASSWORD must keep matching its volume.
# - With --url (or the prompt on a terminal), points NEXT_PUBLIC_APP_URL at
#   that URL; compose derives LUMO_PUBLIC_URL and BETTER_AUTH_URL from it.
# - --realtime adds deploy/self-host/compose.realtime.yml (Soketi) to
#   COMPOSE_FILE and points the browser's realtime connection at the URL's
#   origin (served under /app/ by the caddy profile behind HTTPS);
#   --no-realtime removes it. Other COMPOSE_FILE entries are left alone.
# - --caddy adds the caddy profile (HTTPS on LUMO_DOMAIN) to COMPOSE_PROFILES;
#   --no-caddy removes it. Other profiles are left alone.
# - --local sets LUMO_MODE=local (opens without a sign-in, one account);
#   --no-local removes it.
# - Then runs `docker compose up -d`, waits until the stack is healthy and
#   checks every configured component against the real service
#   (scripts/self-host/check-config.mjs, inside the app container).
#   --no-start stops after writing .env; --check only re-runs the check.
#
# Safe to re-run. POSIX sh; works with the macOS and GNU userlands.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE="$ROOT/.env"
EXAMPLE_FILE="$ROOT/.env.example"
SECRETS="BETTER_AUTH_SECRET CRON_SECRET WORKFLOW_SECRET POSTGRES_PASSWORD"
BASE_FILE=docker-compose.yml
REALTIME_FILE=deploy/self-host/compose.realtime.yml

usage() {
  echo "usage: scripts/self-host/setup.sh [--url <public URL>] [--realtime | --no-realtime] [--caddy | --no-caddy] [--local | --no-local] [--no-start | --check]" >&2
  echo "Run with --help for details." >&2
  exit 2
}

help() {
  cat <<'EOF'
usage: scripts/self-host/setup.sh [--url <public URL>] [--realtime | --no-realtime]
                                  [--caddy | --no-caddy] [--local | --no-local]
                                  [--no-start | --check]

Sets up and starts a self-hosted Lumo:
  1. Writes .env: copies .env.example the first time and generates every
     secret that is still empty (BETTER_AUTH_SECRET, CRON_SECRET,
     WORKFLOW_SECRET, POSTGRES_PASSWORD, and SOKETI_APP_SECRET with
     realtime). A secret that has a value is never replaced.
  2. Runs `docker compose up -d` and waits until the stack is healthy.
  3. Checks that what you configured works, from inside the app: database,
     file storage, email (signs in, sends nothing), Redis, realtime, the
     public URL and sign-in. Exits non-zero when a check fails.
Safe to re-run: to add email, Redis or S3 later, set it in .env and run
setup.sh again.

Options:
  --url <URL>     Public URL of this instance (http:// or https://).
                  Sets NEXT_PUBLIC_APP_URL; compose derives LUMO_PUBLIC_URL
                  and BETTER_AUTH_URL from it. An https URL also sets
                  LUMO_DOMAIN for `docker compose --profile caddy up -d`.
                  Without --url it asks on a terminal; Enter keeps the
                  current URL (http://localhost:3000 on a fresh .env).
  --realtime      Turn on live updates (Soketi): adds
                  deploy/self-host/compose.realtime.yml to COMPOSE_FILE.
  --no-realtime   Turn them off again. Without realtime the UI refreshes
                  when the window regains focus and every minute.
  --caddy         Serve HTTPS on the --url domain with an automatic
                  certificate (adds the caddy profile to COMPOSE_PROFILES).
                  Needs DNS pointing here and ports 80/443 open.
  --no-caddy      Stop serving HTTPS through caddy (e.g. your own proxy).
  --local         Open Lumo without a sign-in (LUMO_MODE=local): the first
                  visit signs you in as this instance's one account. For
                  trying Lumo on your own machine — anyone who can reach the
                  URL is signed in. Without --url it does not ask for one.
  --no-local      Back to normal sign-in; the account keeps its workspaces.
  --no-start      Only write .env; start it yourself with docker compose.
  --check         Only re-run the configuration check on the running stack.
  -h, --help      Show this help.

Without --realtime / --no-realtime, --caddy / --no-caddy or --local /
--no-local the earlier choice is kept (all off on a fresh .env).

Examples:
  scripts/self-host/setup.sh --local      # try it: no questions, no sign-in
  scripts/self-host/setup.sh
  scripts/self-host/setup.sh --url https://lumo.example.com --caddy --realtime
  scripts/self-host/setup.sh --check

Email (SMTP_URL, SMTP_HOST or RESEND_API_KEY), your own Redis (REDIS_URL)
or S3 (BLOB_STORAGE=s3 with S3_*) are optional; set them in .env
(see .env.example).

Docs: docs/self-hosting/README.md
EOF
  exit 0
}

URL=
REALTIME=
CADDY=
LOCAL=
START=on
CHECK_ONLY=
while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || usage; URL=$2; shift 2 ;;
    --url=*) URL=${1#--url=}; shift ;;
    --realtime) REALTIME=on; shift ;;
    --no-realtime) REALTIME=off; shift ;;
    --caddy) CADDY=on; shift ;;
    --no-caddy) CADDY=off; shift ;;
    --local) LOCAL=on; shift ;;
    --no-local) LOCAL=off; shift ;;
    --no-start) START=off; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) help ;;
    *) echo "setup.sh: unknown argument: $1" >&2; usage ;;
  esac
done

check_url() {
  case "$1" in
    http://?*|https://?*) ;;
    *) echo "setup.sh: --url must start with http:// or https:// (got: $1)" >&2; exit 2 ;;
  esac
}
# A bad argument fails before .env is touched at all.
[ -z "$URL" ] || check_url "$URL"
if [ -n "$CHECK_ONLY" ] && { [ -n "$URL$REALTIME$CADDY$LOCAL" ] || [ "$START" = off ]; }; then
  echo "setup.sh: --check takes no other options" >&2
  usage
fi

need_docker() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || {
    echo "setup.sh: Docker with Compose v2 is required (docker compose version)" >&2
    exit 1
  }
}

# The configuration check, run by the app itself inside its container.
run_check() {
  echo
  echo "Checking the configuration..."
  (cd "$ROOT" && docker compose exec -T app node --input-type=module - --report) \
    < "$ROOT/scripts/self-host/check-config.mjs"
}

if [ -n "$CHECK_ONLY" ]; then
  [ -f "$ENV_FILE" ] || { echo "setup.sh: no .env yet; run scripts/self-host/setup.sh first" >&2; exit 1; }
  need_docker
  run_check
  exit $?
fi
[ "$START" = off ] || need_docker

command -v openssl >/dev/null 2>&1 || {
  echo "setup.sh: openssl is required to generate secrets" >&2
  exit 1
}

# Value of the last uncommented KEY= line, without surrounding quotes.
get_var() {
  KEY=$1 awk '
    index($0, ENVIRON["KEY"] "=") == 1 { v = substr($0, length(ENVIRON["KEY"]) + 2) }
    END {
      sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
      print v
    }' "$ENV_FILE"
}

# Replace every uncommented KEY= line with KEY=VALUE, or append one.
set_var() {
  tmp="$ENV_FILE.setup.$$"
  KEY=$1 VALUE=$2 awk '
    index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; found = 1; next }
    { print }
    END { if (!found) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }' "$ENV_FILE" |
    (umask 077 && cat > "$tmp")
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Generate NAME unless it already has a value.
ensure_secret() {
  if [ -z "$(get_var "$1")" ]; then
    set_var "$1" "$(openssl rand -hex 32)"
    echo "Generated $1"
  else
    echo "Kept existing $1"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$EXAMPLE_FILE" ] || { echo "setup.sh: $EXAMPLE_FILE not found" >&2; exit 1; }
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  # Owner-only: the secrets below are written into it. set_var rewrites the
  # file in place, so the mode sticks.
  chmod 600 "$ENV_FILE"
  echo "Created .env from .env.example"
fi

# COMPOSE_FILE: add or drop only the realtime overlay, keeping any file the
# operator listed there themselves.
files=$(get_var COMPOSE_FILE)
case ":$files:" in *":$REALTIME_FILE:"*) realtime_on=1 ;; *) realtime_on= ;; esac
if [ "$REALTIME" = on ] && [ -z "$realtime_on" ]; then
  set_var COMPOSE_FILE "${files:-$BASE_FILE}:$REALTIME_FILE"
  realtime_on=1
elif [ "$REALTIME" = off ] && [ -n "$realtime_on" ]; then
  set_var COMPOSE_FILE "$(printf '%s' ":$files:" | sed "s|:$REALTIME_FILE:|:|; s|^:||; s|:$||")"
  realtime_on=
fi
echo "Realtime: $([ -n "$realtime_on" ] && echo on || echo off)"

# COMPOSE_PROFILES (comma-separated): add or drop only caddy.
profiles=$(get_var COMPOSE_PROFILES)
case ",$profiles," in *",caddy,"*) caddy_on=1 ;; *) caddy_on= ;; esac
if [ "$CADDY" = on ] && [ -z "$caddy_on" ]; then
  set_var COMPOSE_PROFILES "${profiles:+$profiles,}caddy"
  caddy_on=1
elif [ "$CADDY" = off ] && [ -n "$caddy_on" ]; then
  set_var COMPOSE_PROFILES "$(printf '%s' ",$profiles," | sed 's|,caddy,|,|; s|^,||; s|,$||')"
  caddy_on=
fi
echo "HTTPS via caddy: $([ -n "$caddy_on" ] && echo on || echo off)"

# LUMO_MODE: only local is ever written; --no-local blanks it.
if [ "$LOCAL" = on ]; then
  set_var LUMO_MODE local
elif [ "$LOCAL" = off ] && [ -n "$(get_var LUMO_MODE)" ]; then
  set_var LUMO_MODE ""
fi
case "$(get_var LUMO_MODE)" in local) local_on=1 ;; *) local_on= ;; esac
echo "Local mode (no sign-in): $([ -n "$local_on" ] && echo on || echo off)"

[ -z "$realtime_on" ] || SECRETS="$SECRETS SOKETI_APP_SECRET"
for name in $SECRETS; do ensure_secret "$name"; done

if [ -z "$URL" ] && [ -t 0 ] && [ -z "$local_on" ]; then
  current=$(get_var NEXT_PUBLIC_APP_URL)
  printf 'Public URL of this Lumo [%s]: ' "${current:-http://localhost:3000}"
  read -r URL || URL=
  # Enter keeps an existing URL as it is (including any hand-tuned realtime
  # settings); on a fresh .env it accepts the localhost default.
  [ -n "$URL" ] || [ -n "$current" ] || URL=http://localhost:3000
fi

# The realtime settings follow the URL when it changes, and are filled in
# once when realtime is turned on for a .env that has none yet.
EFFECTIVE_URL=$URL
if [ -z "$EFFECTIVE_URL" ] && [ -n "$realtime_on" ] && [ -z "$(get_var SOKETI_PUBLIC_HOST)" ]; then
  EFFECTIVE_URL=$(get_var NEXT_PUBLIC_APP_URL)
  EFFECTIVE_URL=${EFFECTIVE_URL:-http://localhost:3000}
fi

if [ -n "$EFFECTIVE_URL" ]; then
  EFFECTIVE_URL=$(printf '%s' "$EFFECTIVE_URL" | sed 's:/*$::')
  # Also covers a URL typed at the prompt or one already in .env.
  check_url "$EFFECTIVE_URL"
  host=${EFFECTIVE_URL#*://}
  host=${host%%/*}
  host=${host##*@}
  # hostname and the explicit port (empty when the URL names none);
  # an IPv6 literal keeps its brackets, as a URL host must.
  case "$host" in
    \[*)
      hostname="${host%%]*}]"
      port=${host#*]}
      port=${port#:}
      ;;
    *:*) hostname=${host%%:*}; port=${host##*:} ;;
    *) hostname=$host; port= ;;
  esac
  if [ -n "$URL" ]; then
    set_var NEXT_PUBLIC_APP_URL "$EFFECTIVE_URL"
    case "$EFFECTIVE_URL" in
      https://*) set_var LUMO_DOMAIN "$hostname" ;;
      *) [ -z "$(get_var LUMO_DOMAIN)" ] || set_var LUMO_DOMAIN "" ;;
    esac
    echo "Public URL set to $EFFECTIVE_URL"
  fi
  if [ -n "$realtime_on" ]; then
    case "$EFFECTIVE_URL" in
      https://*)
        # Behind the caddy profile (or any proxy sending /app/ to Soketi):
        # realtime shares the app's origin — its port, 443 unless the URL
        # names one.
        set_var SOKETI_PUBLIC_HOST "$hostname"
        set_var SOKETI_PUBLIC_PORT "${port:-443}"
        set_var SOKETI_PUBLIC_TLS true
        ;;
      *)
        # Plain HTTP: the browser reaches Soketi directly on port 6001.
        set_var SOKETI_PUBLIC_HOST "$hostname"
        set_var SOKETI_PUBLIC_PORT 6001
        set_var SOKETI_PUBLIC_TLS false
        ;;
    esac
  fi
fi

if [ -n "$caddy_on" ] && [ -z "$(get_var LUMO_DOMAIN)" ]; then
  echo
  echo "Warning: caddy is on but LUMO_DOMAIN is empty; run setup.sh --url https://<your domain>."
fi

if [ "$START" = off ]; then
  if [ -z "$(get_var SMTP_URL)" ] && [ -z "$(get_var SMTP_HOST)" ] && [ -z "$(get_var RESEND_API_KEY)" ]; then
    echo
    echo "Warning: no email configured (SMTP_URL, SMTP_HOST or RESEND_API_KEY)."
    echo "  Sign-in works, but nobody can verify an address, so workspace invites"
    echo "  cannot be accepted. Set one in .env before inviting your team."
  fi
  echo
  echo "Next: docker compose up -d, then scripts/self-host/setup.sh --check"
  exit 0
fi

echo
echo "Starting Lumo (the first start pulls the images and applies the migrations)..."
# --remove-orphans drops Soketi after --no-realtime; --wait returns once
# every service is healthy (or fails when one is not).
(cd "$ROOT" && docker compose up -d --remove-orphans --wait --wait-timeout 600) || {
  echo
  echo "setup.sh: the stack did not become healthy; see: docker compose logs app" >&2
  exit 1
}

if run_check; then
  echo
  app_url=$(get_var NEXT_PUBLIC_APP_URL)
  echo "Lumo is running at ${app_url:-http://localhost:3000}"
  if [ -n "$local_on" ]; then
    echo "Local mode: open it in a browser, no sign-in needed."
    echo "Connect the lumo CLI (no key to copy): lumo auth login --url ${app_url:-http://localhost:3000}"
  fi
else
  exit $?
fi
