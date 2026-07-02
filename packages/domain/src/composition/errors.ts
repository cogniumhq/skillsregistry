// ══════════════════════════════════════════════════════════════════════════════
// Composition — typed errors
// ══════════════════════════════════════════════════════════════════════════════
//
// Callers rely on `instanceof NotFoundError` / `instanceof ValidationError` to
// map to the right HTTP status code (404 vs 400). Keeping these adjacent to
// the composition functions instead of scattered across each file mirrors
// mothership's shape (fork.ts owned NotFoundError, compose.ts owned
// ValidationError) but centralizes it for cleaner imports.
//
// ══════════════════════════════════════════════════════════════════════════════

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
