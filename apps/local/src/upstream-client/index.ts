// ══════════════════════════════════════════════════════════════════════════════
// upstream-client — sole doorway from apps/local to `api.skillsregistry.net`.
// ══════════════════════════════════════════════════════════════════════════════

export { UpstreamClient } from './client.js';
export type { UpstreamClientOptions } from './client.js';
export { UpstreamError } from './errors.js';
export type { UpstreamErrorOptions } from './errors.js';
export { TokenBucket } from './token-bucket.js';
export type { TokenBucketOptions, TokenBucketResult } from './token-bucket.js';
