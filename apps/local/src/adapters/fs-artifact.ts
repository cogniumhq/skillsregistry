// ══════════════════════════════════════════════════════════════════════════════
// FsArtifact — ArtifactAdapter over the local filesystem.
// ══════════════════════════════════════════════════════════════════════════════
//
// Blobs live under `<baseDir>/<key>` where `key` may contain `/` for nesting.
// Path traversal (`..`) and absolute paths are rejected — the adapter never
// writes outside the configured base.
//
// `contentType` is accepted but ignored (the filesystem has no notion of it);
// the interface documents the metadata is best-effort.
//
// ══════════════════════════════════════════════════════════════════════════════

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import type { ArtifactAdapter } from '@skillsregistry/domain/adapters';

export class FsArtifact implements ArtifactAdapter {
  constructor(private readonly baseDir: string) {
    if (!isAbsolute(baseDir)) {
      throw new Error(
        `[fs-artifact] baseDir must be an absolute path, got: ${baseDir}`,
      );
    }
  }

  private toPath(key: string): string {
    if (key === '' || key === '/') {
      throw new Error('[fs-artifact] key must be non-empty');
    }
    if (isAbsolute(key)) {
      throw new Error(`[fs-artifact] key must not be absolute: ${key}`);
    }
    const normalized = normalize(key);
    if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`)) {
      throw new Error(`[fs-artifact] key must not traverse parents: ${key}`);
    }
    return join(this.baseDir, normalized);
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.toPath(key));
      // Return a fresh Uint8Array view — decouples from Node's Buffer type.
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(key: string, body: Uint8Array): Promise<void> {
    const path = this.toPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.toPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }
}
