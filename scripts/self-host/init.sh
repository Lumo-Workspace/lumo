#!/bin/sh
# LUM-1325 — prepare .env for `docker compose up -d` (self-hosting).
#
#   scripts/self-host/init.sh [--url https://lumo.example.com]
#
# - Copies .env.example to .env when .env does not exist yet.
# - Fills every secret docker-compose.yml requires with `openssl rand -hex 32`.
#   A secret that already has a value is never replaced: rotating
#   BETTER_AUTH_SECRET signs everybody out, and POSTGRES_PASSWORD /
#   MINIO_ROOT_PASSWORD must keep matching the data volumes.
# - With --url (or the prompt on a terminal), points NEXT_PUBLIC_APP_URL,
#   LUMO_PUBLIC_URL and BETTER_AUTH_URL at that URL and the browser's realtime
#   connection at the same origin (served under /app/ by the caddy profile).
#   Without either, the URL settings already in .env are kept.
# - Warns when no email is configured (invites need it).
#
# Safe to re-run. POSIX sh; works with the macOS and GNU userlands.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE="$ROOT/.env"
EXAMPLE_FILE="$ROOT/.env.example"
SECRETS="BETTER_AUTH_SECRET CRON_SECRET WORKFLOW_SECRET POSTGRES_PASSWORD MINIO_ROOT_PASSWORD SOKETI_APP_SECRET"

usage() {
  echo "usage: scripts/self-host/init.sh [--url <public URL>]" >&2
  exit 2
}

URL=
while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || usage; URL=$2; shift 2 ;;
    --url=*) URL=${1#--url=}; shift ;;
    -h|--help) usage ;;
    *) echo "init.sh: unknown argument: $1" >&2; usage ;;
  esac
done

command -v openssl >/dev/null 2>&1 || {
  echo "init.sh: openssl is required to generate secrets" >&2
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
  tmp="$ENV_FILE.init.$$"
  KEY=$1 VALUE=$2 awk '
    index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; found = 1; next }
    { print }
    END { if (!found) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }' "$ENV_FILE" |
    (umask 077 && cat > "$tmp")
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$EXAMPLE_FILE" ] || { echo "init.sh: $EXAMPLE_FILE not found" >&2; exit 1; }
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  # Owner-only: the secrets below are written into it. set_var rewrites the
  # file in place, so the mode sticks.
  chmod 600 "$ENV_FILE"
  echo "Created .env from .env.example"
fi

for name in $SECRETS; do
  if [ -z "$(get_var "$name")" ]; then
    set_var "$name" "$(openssl rand -hex 32)"
    echo "Generated $name"
  else
    echo "Kept existing $name"
  fi
done

if [ -z "$URL" ] && [ -t 0 ]; then
  current=$(get_var NEXT_PUBLIC_APP_URL)
  printf 'Public URL of this Lumo [%s]: ' "${current:-http://localhost:3000}"
  read -r URL || URL=
  # Enter keeps an existing URL as it is (including any hand-tuned realtime
  # settings); on a fresh .env it accepts the localhost default.
  [ -n "$URL" ] || [ -n "$current" ] || URL=http://localhost:3000
fi

if [ -n "$URL" ]; then
  URL=$(printf '%s' "$URL" | sed 's:/*$::')
  case "$URL" in
    http://?*|https://?*) ;;
    *) echo "init.sh: --url must start with http:// or https:// (got: $URL)" >&2; exit 2 ;;
  esac
  host=${URL#*://}
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
  for name in NEXT_PUBLIC_APP_URL LUMO_PUBLIC_URL BETTER_AUTH_URL; do
    set_var "$name" "$URL"
  done
  case "$URL" in
    https://*)
      # Behind the caddy profile (or any proxy sending /app/ to Soketi):
      # realtime shares the app's origin — its port, 443 unless the URL
      # names one.
      set_var LUMO_DOMAIN "$hostname"
      set_var SOKETI_PUBLIC_HOST "$hostname"
      set_var SOKETI_PUBLIC_PORT "${port:-443}"
      set_var SOKETI_PUBLIC_TLS true
      ;;
    *)
      # Plain HTTP: the browser reaches Soketi directly on port 6001, and
      # the caddy profile has no domain to serve.
      [ -z "$(get_var LUMO_DOMAIN)" ] || set_var LUMO_DOMAIN ""
      set_var SOKETI_PUBLIC_HOST "$hostname"
      set_var SOKETI_PUBLIC_PORT 6001
      set_var SOKETI_PUBLIC_TLS false
      ;;
  esac
  echo "Public URL set to $URL"
fi

if [ -z "$(get_var SMTP_URL)" ] && [ -z "$(get_var SMTP_HOST)" ] && [ -z "$(get_var RESEND_API_KEY)" ]; then
  echo
  echo "Warning: no email configured (SMTP_URL, SMTP_HOST or RESEND_API_KEY)."
  echo "  Sign-in works, but nobody can verify an address, so workspace invites"
  echo "  cannot be accepted. Set one in .env before inviting your team."
fi

echo
echo "Next: docker compose up -d"
