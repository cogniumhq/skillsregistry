// ══════════════════════════════════════════════════════════════════════════════
// Schema version — bumped when a new migration lands.
// ══════════════════════════════════════════════════════════════════════════════
//
// Consumers assert that the DB's `schema_migrations` table has been fast-
// forwarded to at least this version before starting. See `runner.ts`.
//
// Bump this number in the SAME PR that adds a new `NNNN_*.sql` migration
// file. Never re-use an old number. The migration file's number and this
// constant must move together.
//
// ══════════════════════════════════════════════════════════════════════════════

export const SCHEMA_VERSION = 34;
