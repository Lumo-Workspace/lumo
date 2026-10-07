# Scheduler for self-hosted Lumo (LUM-1028): supercronic running the
# generated crontab next to this file. Build context: deploy/self-host.
# See docs/self-hosting/cron.md. Needs CRON_SECRET and APP_URL at runtime.
FROM alpine:3.22
# curl >= 7.76 for cron-run.sh's --fail-with-body; tzdata so TZ applies.
RUN apk add --no-cache supercronic curl ca-certificates tzdata
COPY crontab cron-run.sh /opt/lumo/
RUN chmod 0755 /opt/lumo/cron-run.sh
USER nobody
# Absolute path: as PID 1 supercronic re-executes itself (to reap children)
# via argv[0], which must therefore resolve without a PATH lookup.
CMD ["/usr/bin/supercronic", "/opt/lumo/crontab"]
