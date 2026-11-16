/** Erreurs structurées renvoyées par l'API : { error: { code, message, details? } }. */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DUPLICATE"
  | "PAYMENT_IN_PROGRESS"
  | "NOT_CONNECTED"
  | "RATE_LIMITED"
  | "DEMO_FORBIDDEN";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  PERIOD_CLOSED: 409,
  DUPLICATE: 409,
  PAYMENT_IN_PROGRESS: 409,
  NOT_CONNECTED: 503,
  RATE_LIMITED: 429,
  DEMO_FORBIDDEN: 403,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details ?? null } };
  }
}

export const forbidden = (m = "Droits insuffisants pour cette ressource.") => new AppError("FORBIDDEN", m);
/** Ressource introuvable OU non autorisée : on ne révèle pas l'existence d'une ressource d'un autre tenant. */
export const notFound = (m = "Ressource introuvable.") => new AppError("NOT_FOUND", m);
export const validation = (m: string, details?: unknown) => new AppError("VALIDATION", m, details);
