import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsArtifact } from './fs-artifact.js';

describe('FsArtifact', () => {
  let base: string;
  let adapter: FsArtifact;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'fs-artifact-'));
    adapter = new FsArtifact(base);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('rejects a relative baseDir', () => {
    expect(() => new FsArtifact('./relative')).toThrow(/absolute/);
  });

  it('write + read roundtrips a blob', async () => {
    const body = new TextEncoder().encode('hello');
    await adapter.write('greetings/en.txt', body);
    const disk = await readFile(join(base, 'greetings', 'en.txt'));
    expect(new TextDecoder().decode(disk)).toBe('hello');
    const round = await adapter.read('greetings/en.txt');
    expect(round).not.toBeNull();
    expect(new TextDecoder().decode(round!)).toBe('hello');
  });

  it('read returns null for a missing key', async () => {
    expect(await adapter.read('missing.txt')).toBeNull();
  });

  it('delete removes the blob and is idempotent on missing keys', async () => {
    await adapter.write('gone.txt', new Uint8Array([1, 2, 3]));
    await adapter.delete('gone.txt');
    expect(await adapter.read('gone.txt')).toBeNull();
    await expect(adapter.delete('gone.txt')).resolves.toBeUndefined();
  });

  it('rejects empty keys', async () => {
    await expect(adapter.write('', new Uint8Array())).rejects.toThrow(
      /non-empty/,
    );
  });

  it('rejects absolute keys', async () => {
    await expect(
      adapter.write(`${sep}etc${sep}passwd`, new Uint8Array()),
    ).rejects.toThrow(/must not be absolute/);
  });

  it('rejects parent-traversal keys', async () => {
    await expect(
      adapter.write('../escape.txt', new Uint8Array()),
    ).rejects.toThrow(/must not traverse parents/);
    await expect(
      adapter.write(`good${sep}..${sep}..${sep}bad.txt`, new Uint8Array()),
    ).rejects.toThrow(/must not traverse parents/);
  });

  it('nested writes create intermediate directories', async () => {
    await adapter.write('a/b/c/d.bin', new Uint8Array([9]));
    const disk = await readFile(join(base, 'a', 'b', 'c', 'd.bin'));
    expect(disk[0]).toBe(9);
  });
});
