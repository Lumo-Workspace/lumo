/**
 * LUM-927 — how long an active installation may go without a token before
 * the daily access recheck raises an ops alert and the settings card tells
 * the workspace. Its own module: the install service (the card) and the
 * recheck service both read it, and the recheck already imports the former.
 */
export const TOKEN_FAILING_ALERT_MS = 3 * 24 * 60 * 60 * 1000
