#!/bin/sh
# LUM-1325, LUM-1332 — prepare .env for `docker compose up -d` (self-hosting).
#
#   scripts/self-host/setup.sh [--url https://lumo.example.com] [--with <components>]
#
# - Copies .env.example to .env when .env does not exist yet.
# - Picks the optional components (--with, comma-separated: redis, minio,
#   realtime, all or none) and writes COMPOSE_FILE so a plain
#   `docker compose up -d` loads their overlay files from deploy/self-host/.
#   Without --with, an existing choice is kept. A .env from before LUM-1332
#   (it holds MINIO_ROOT_PASSWORD or SOKETI_APP_SECRET) keeps all three, so
#   files stored in MinIO stay reachable; a fresh .env gets none of them.
# - Fills every secret the chosen components need with `openssl rand -hex 32`.
#   A secret that already has a value is never replaced: rotating
#   BETTER_AUTH_SECRET signs everybody out, and POSTGRES_PASSWORD /
#   MINIO_ROOT_PASSWORD must keep matching the data volumes.
# - With --url (or the prompt on a terminal), points NEXT_PUBLIC_APP_URL at
#   that URL; compose derives LUMO_PUBLIC_URL and BETTER_AUTH_URL from it.
#   With realtime on, the browser's realtime connection goes to the same
#   origin behind HTTPS (served under /app/ by the caddy profile).
# - Warns when no email is configured (invites need it).
#
# Safe to re-run. POSIX sh; works with the macOS and GNU userlands.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE="$ROOT/.env"
EXAMPLE_FILE="$ROOT/.env.example"
BASE_SECRETS="BETTER_AUTH_SECRET CRON_SECRET WORKFLOW_SECRET POSTGRES_PASSWORD"
ALL_COMPONENTS="redis minio realtime"

usage() {
  echo "usage: scripts/self-host/setup.sh [--url <public URL>] [--with redis,minio,realtime|all|none]" >&2
  exit 2
}

URL=
WITH=
WITH_SET=
while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || usage; URL=$2; shift 2 ;;
    --url=*) URL=${1#--url=}; shift ;;
    --with) [ $# -ge 2 ] || usage; WITH=$2; WITH_SET=1; shift 2 ;;
    --with=*) WITH=${1#--with=}; WITH_SET=1; shift ;;
    -h|--help) usage ;;
    *) echo "setup.sh: unknown argument: $1" >&2; usage ;;
  esac
done

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

has_component() {
  case " $COMPONENTS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$EXAMPLE_FILE" ] || { echo "setup.sh: $EXAMPLE_FILE not found" >&2; exit 1; }
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  # Owner-only: the secrets below are written into it. set_var rewrites the
  # file in place, so the mode sticks.
  chmod 600 "$ENV_FILE"
  echo "Created .env from .env.example"
fi

# Optional components: --with, else the COMPOSE_FILE written by an earlier
# run, else everything for a pre-LUM-1332 .env, else none.
COMPONENTS=
if [ -n "$WITH_SET" ]; then
  for c in $(printf '%s' "$WITH" | tr ',' ' '); do
    case "$c" in
      all) COMPONENTS=$ALL_COMPONENTS ;;
      none) ;;
      redis|minio|realtime) has_component "$c" || COMPONENTS="$COMPONENTS $c" ;;
      *) echo "setup.sh: unknown component: $c (redis, minio, realtime, all, none)" >&2; exit 2 ;;
    esac
  done
else
  current_files=$(get_var COMPOSE_FILE)
  if [ -n "$current_files" ]; then
    for c in $ALL_COMPONENTS; do
      case "$current_files" in *"compose.$c.yml"*) COMPONENTS="$COMPONENTS $c" ;; esac
    done
  elif [ -n "$(get_var MINIO_ROOT_PASSWORD)" ] || [ -n "$(get_var SOKETI_APP_SECRET)" ]; then
    COMPONENTS=$ALL_COMPONENTS
    echo "Kept redis, minio and realtime from the earlier setup of this .env"
  fi
fi

# Dropping MinIO would leave its files unreachable: the app then stores new
# files on disk and cannot read the old ones. The migrate service refuses to
# start in that state too.
if ! has_component minio && [ -n "$(get_var MINIO_ROOT_PASSWORD)" ]; then
  echo "setup.sh: this .env stores files in MinIO (MINIO_ROOT_PASSWORD is set)." >&2
  echo "  Keep it with --with minio (or --with all). To stop using MinIO, move the" >&2
  echo "  files first, then delete MINIO_ROOT_PASSWORD from .env." >&2
  exit 2
fi

files=docker-compose.yml
for c in $COMPONENTS; do files="$files:deploy/self-host/compose.$c.yml"; done
set_var COMPOSE_FILE "$files"
echo "Optional components: $(echo $COMPONENTS | tr ' ' ',' | sed 's/^$/none/')"

SECRETS=$BASE_SECRETS
has_component minio && SECRETS="$SECRETS MINIO_ROOT_PASSWORD"
has_component realtime && SECRETS="$SECRETS SOKETI_APP_SECRET"
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
if [ -z "$EFFECTIVE_URL" ] && has_component realtime && [ -z "$(get_var SOKETI_PUBLIC_HOST)" ]; then
  EFFECTIVE_URL=$(get_var NEXT_PUBLIC_APP_URL)
  EFFECTIVE_URL=${EFFECTIVE_URL:-http://localhost:3000}
fi

if [ -n "$EFFECTIVE_URL" ]; then
  EFFECTIVE_URL=$(printf '%s' "$EFFECTIVE_URL" | sed 's:/*$::')
  case "$EFFECTIVE_URL" in
    http://?*|https://?*) ;;
    *) echo "setup.sh: --url must start with http:// or https:// (got: $EFFECTIVE_URL)" >&2; exit 2 ;;
  esac
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
    # Compose derives both from NEXT_PUBLIC_APP_URL; a value an earlier
    # init.sh wrote would otherwise keep pointing at the old URL.
    for name in LUMO_PUBLIC_URL BETTER_AUTH_URL; do
      [ -z "$(get_var "$name")" ] || set_var "$name" "$EFFECTIVE_URL"
    done
    case "$EFFECTIVE_URL" in
      https://*) set_var LUMO_DOMAIN "$hostname" ;;
      *) [ -z "$(get_var LUMO_DOMAIN)" ] || set_var LUMO_DOMAIN "" ;;
    esac
    echo "Public URL set to $EFFECTIVE_URL"
  fi
  if has_component realtime; then
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
