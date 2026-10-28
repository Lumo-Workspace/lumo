#!/bin/sh
# LUM-1325, LUM-1332 — prepare .env for `docker compose up -d` (self-hosting).
#
#   scripts/self-host/setup.sh [--url https://lumo.example.com] [--realtime | --no-realtime]
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
# - Warns when no email is configured (invites need it).
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
  echo "usage: scripts/self-host/setup.sh [--url <public URL>] [--realtime | --no-realtime]" >&2
  exit 2
}

URL=
REALTIME=
while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || usage; URL=$2; shift 2 ;;
    --url=*) URL=${1#--url=}; shift ;;
    --realtime) REALTIME=on; shift ;;
    --no-realtime) REALTIME=off; shift ;;
    -h|--help) usage ;;
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

[ -z "$realtime_on" ] || SECRETS="$SECRETS SOKETI_APP_SECRET"
for name in $SECRETS; do ensure_secret "$name"; done

if [ -z "$URL" ] && [ -t 0 ]; then
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

if [ -z "$(get_var SMTP_URL)" ] && [ -z "$(get_var SMTP_HOST)" ] && [ -z "$(get_var RESEND_API_KEY)" ]; then
  echo
  echo "Warning: no email configured (SMTP_URL, SMTP_HOST or RESEND_API_KEY)."
  echo "  Sign-in works, but nobody can verify an address, so workspace invites"
  echo "  cannot be accepted. Set one in .env before inviting your team."
fi

echo
echo "Next: docker compose up -d"
