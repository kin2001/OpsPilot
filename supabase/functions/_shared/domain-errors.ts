const messages = {
  UNAUTHENTICATED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have permission for this action.',
  NOT_FOUND: 'This record is unavailable.',
  VALIDATION: 'Check the entered values.',
  CONFLICT: 'This record changed. Refresh it before trying again.',
  INVALID_TRANSITION: 'This action is unavailable in the current state.',
  INSUFFICIENT_STOCK: 'There is not enough available stock.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  DEPENDENCY_UNAVAILABLE: 'This action is temporarily unavailable.',
} as const;
export type DomainError = { code: keyof typeof messages; message: string; retryable: boolean; request_id?: string };
export function domainError(error: unknown, request_id?: string): DomainError {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  const code = typeof message === 'string' && Object.hasOwn(messages, message) ? message as keyof typeof messages : 'DEPENDENCY_UNAVAILABLE';
  return { code, message: messages[code], retryable: code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED', ...(request_id ? { request_id } : {}) };
}
