/**
 * Logging utility for authentication events and security monitoring
 * Follows SR-019: Authentication logs MUST include timestamp, IP address, user agent, result
 */

export interface LogContext {
  timestamp: string
  ip?: string | undefined
  userAgent?: string | undefined
  userId?: string | undefined
  email?: string | undefined
  action: string
  result: 'success' | 'failure'
  details?: Record<string, any> | undefined
}

export class AuthLogger {
  private static sanitizeForLog(data: any): any {
    // Remove sensitive information from logs per SR-012
    if (typeof data === 'object' && data !== null) {
      const sanitized = { ...data }
      // Remove PII from logs
      delete sanitized.password
      delete sanitized.access_token
      delete sanitized.refresh_token
      delete sanitized.id_token
      return sanitized
    }
    return data
  }

  static log(context: LogContext): void {
    const sanitizedContext = {
      ...context,
      details: context.details
        ? this.sanitizeForLog(context.details)
        : undefined,
    }

    // In production, this would integrate with proper logging service
    console.log(
      `[AUTH] ${context.timestamp} - ${context.action} - ${context.result}`,
      sanitizedContext
    )
  }

  static logSignIn(
    userId: string,
    email: string,
    provider: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      email,
      action: 'sign_in',
      result: 'success',
      details: { provider },
    })
  }

  static logSignInFailure(
    email: string,
    reason: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      email,
      action: 'sign_in',
      result: 'failure',
      details: { reason },
    })
  }

  static logSignOut(
    userId: string,
    email: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      email,
      action: 'sign_out',
      result: 'success',
    })
  }

  static logAccountLink(
    userId: string,
    email: string,
    provider: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      email,
      action: 'account_link',
      result: 'success',
      details: { provider },
    })
  }

  static logAccountUnlink(
    userId: string,
    email: string,
    provider: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      email,
      action: 'account_unlink',
      result: 'success',
      details: { provider },
    })
  }

  static logRateLimitExceeded(ip: string, userAgent?: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      action: 'rate_limit_exceeded',
      result: 'failure',
      details: { reason: 'too_many_attempts' },
    })
  }

  static logSecurityIncident(
    incident: string,
    details: Record<string, any>,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      action: 'security_incident',
      result: 'failure',
      details: { incident, ...this.sanitizeForLog(details) },
    })
  }

  static logAccountLinkingAttempt(
    userId: string,
    provider: string,
    email: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      email,
      action: 'account_linking_attempt',
      result: 'success',
      details: { provider },
    })
  }

  static logAccountLinkingSuccess(
    userId: string,
    provider: string,
    accountId: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_linking_success',
      result: 'success',
      details: { provider, accountId },
    })
  }

  static logAccountLinkingError(
    userId: string,
    provider: string,
    error: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_linking_error',
      result: 'failure',
      details: { provider, error },
    })
  }

  static logAccountUnlinkingAttempt(
    userId: string,
    provider: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_unlinking_attempt',
      result: 'success',
      details: { provider },
    })
  }

  static logAccountUnlinkingSuccess(
    userId: string,
    provider: string,
    accountId: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_unlinking_success',
      result: 'success',
      details: { provider, accountId },
    })
  }

  static logAccountUnlinkingError(
    userId: string,
    provider: string,
    error: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_unlinking_error',
      result: 'failure',
      details: { provider, error },
    })
  }

  static logAccountMergeAttempt(
    userId: string,
    email: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      email,
      action: 'account_merge_attempt',
      result: 'success',
      details: {},
    })
  }

  static logAccountMergeSuccess(
    userId: string,
    accountId: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_merge_success',
      result: 'success',
      details: { accountId },
    })
  }

  static logAccountMergeError(
    userId: string,
    error: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_merge_error',
      result: 'failure',
      details: { error },
    })
  }

  static logAccountConflictResolution(
    userId: string,
    googleUserId: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_conflict_resolution',
      result: 'success',
      details: { googleUserId },
    })
  }

  static logAccountConflictResolutionSuccess(
    userId: string,
    googleUserId: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_conflict_resolution_success',
      result: 'success',
      details: { googleUserId },
    })
  }

  static logAccountConflictResolutionError(
    userId: string,
    googleUserId: string,
    error: string,
    ip?: string,
    userAgent?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      userId,
      action: 'account_conflict_resolution_error',
      result: 'failure',
      details: { googleUserId, error },
    })
  }

  static logError(message: string, context?: any): void {
    this.log({
      timestamp: new Date().toISOString(),
      action: 'error',
      result: 'failure',
      details: { message, ...this.sanitizeForLog(context) },
    })
  }
}
