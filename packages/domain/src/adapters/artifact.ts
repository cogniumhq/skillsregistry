// ══════════════════════════════════════════════════════════════════════════════
// ArtifactAdapter — blob storage abstraction
// ══════════════════════════════════════════════════════════════════════════════
//
// Skill bundles, publisher-key metadata, and eval fixtures live outside the
// hot path of Postgres. The mothership stores them in R2 / S3. The local
// node stores them on the local filesystem under `./data/artifacts/`.
//
// Design constraints:
//
//   - Blobs are `Uint8Array`. Text callers encode/decode themselves.
//   - Read returns `null` on miss (not an exception) to keep the caller
//     shape symmetric with `KvAdapter.get`.
//   - `contentType` is metadata only — implementers are free to ignore it
//     when the backend has no notion of it.
//   - No signed-URL surface here — that's a mothership-only concern and
//     lives outside the domain layer.
//
// ══════════════════════════════════════════════════════════════════════════════

export interface ArtifactWriteOptions {
  /** Optional MIME type. Implementers may ignore. */
  contentType?: string;
}

export interface ArtifactAdapter {
  /**
   * Read a blob. Returns `null` when the key does not exist.
   */
  read(key: string): Promise<Uint8Array | null>;

  /**
   * Write a blob. Overwrites any existing value at `key`.
   */
  write(
    key: string,
    body: Uint8Array,
    options?: ArtifactWriteOptions,
  ): Promise<void>;

  /**
   * Delete a blob. Idempotent — deleting a missing key is not an error.
   */
  delete(key: string): Promise<void>;
}
