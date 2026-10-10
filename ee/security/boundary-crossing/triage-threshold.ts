/**
 * LUM-945 — the AI triage auto-clear threshold on P(legit). Its own module so
 * the panel can show it without importing the triage prompt builder (which
 * pulls the secret registry into the client bundle).
 */
export const TRIAGE_THRESHOLD = 0.6
