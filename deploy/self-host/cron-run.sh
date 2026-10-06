#!/bin/sh
# LUM-1023: one scheduled call from deploy/self-host/crontab.
#
#   cron-run.sh <job-name> <path>
#
# Sends `Authorization: Bearer $CRON_SECRET` (what lib/api/cron-auth.ts checks)
# to ${APP_URL}<path>. The header is piped to curl on stdin so the secret never
# appears in the process list or in supercronic's command log.
#
# LUMO_CRON_DISABLED is a comma-separated list of job names to skip,
# e.g. LUMO_CRON_DISABLED=triage-crossings,rejudge-crossings
set -eu

name="${1:?usage: cron-run.sh <job-name> <path>}"
path="${2:?usage: cron-run.sh <job-name> <path>}"

disabled="$(printf '%s' "${LUMO_CRON_DISABLED:-}" | tr -d ' ')"
case ",${disabled}," in
  *",${name},"*)
    echo "lumo-cron ${name}: skipped (in LUMO_CRON_DISABLED)"
    exit 0
    ;;
esac

: "${APP_URL:?lumo-cron: APP_URL is not set}"
: "${CRON_SECRET:?lumo-cron: CRON_SECRET is not set}"

url="${APP_URL%/}${path}"
echo "lumo-cron ${name}: GET ${path}"
# --max-time: the longest route (backfill-lineage-outcomes) allows 800s.
# --fail-with-body needs curl >= 7.76.
status=0
printf 'Authorization: Bearer %s\n' "${CRON_SECRET}" \
  | curl --fail-with-body --silent --show-error \
      --max-time "${LUMO_CRON_TIMEOUT:-900}" \
      -H @- "${url}" || status=$?
echo
if [ "$status" -eq 0 ]; then
  echo "lumo-cron ${name}: ok"
else
  echo "lumo-cron ${name}: FAILED (curl exit ${status})" >&2
fi
exit "$status"
