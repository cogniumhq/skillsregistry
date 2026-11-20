import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCanonicalPayload, buildCanonicalRequest, canonicalize, popMessage, signPublish,
} from './sr-publish.mjs';

// The registry rejects any byte of drift as `bad_sig`. golden-vectors.json was
// produced by the registry's own canonicalization code (see its
// `generatedFrom`); these tests pin this tool to it.

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, 'sr-publish.mjs');
const golden = JSON.parse(readFileSync(join(HERE, 'golden-vectors.json'), 'utf8'));
const run = promisify(execFile);

describe('canonical forms match the registry', () => {
  it.each(golden.publish.map((v) => [v.body.slug, v]))('publish payload: %s', async (_slug, v) => {
    expect(canonicalize(await buildCanonicalPayload(v.body, golden.sig))).toBe(v.canonical);
  });

  it.each(golden.requests.map((v) => [`${v.method} ${v.path}`, v]))('request: %s', async (_name, v) => {
    const canonical = await buildCanonicalRequest({
      method: v.method, path: v.path, body: new TextEncoder().encode(v.bodyText),
      keyId: golden.sig.publisherKeyId, signedAt: golden.sig.signedAt, nonce: golden.sig.nonce,
    });
    expect(canonicalize(canonical)).toBe(v.canonical);
  });

  it('proof-of-possession message', () => {
    expect(popMessage(golden.pop.nonce, golden.pop.publicKey)).toBe(golden.pop.message);
  });
});

describe('signing', () => {
  it('X-Skill-Signature verifies over the canonical bytes', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyFile = {
      keyId: 'pk_test', authorId: 'a',
      publicKeyB64Url: (await crypto.subtle.exportKey('jwk', pair.publicKey)).x,
      privateKeyB64Url: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d,
    };
    const v = golden.publish[1];
    const { headers } = await signPublish({ ...keyFile, keyId: golden.sig.publisherKeyId }, v.body, golden.sig);
    const ok = await crypto.subtle.verify(
      'Ed25519', pair.publicKey, Buffer.from(headers['X-Skill-Signature'], 'base64url'), new TextEncoder().encode(v.canonical),
    );
    expect(ok).toBe(true);
    expect(headers['X-Skill-Signed-At']).toBe(golden.sig.signedAt);
  });
});

function stub({ onRegister, registerStatus = 201 } = {}) {
  const seen = { auth: [], urls: [], pop: undefined };
  let polls = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      seen.urls.push(req.url);
      if (req.headers.authorization) seen.auth.push(req.headers.authorization);
      if (req.url === '/v1/identity/device/start') return send(200, { device_code: 'dc', user_code: 'WXYZ-9876', verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 0 });
      if (req.url === '/v1/identity/device/token') return polls++ < 1 ? send(202, { status: 'pending', slow_down: false }) : send(200, { session: 'sess', expires_at: 'x', login: 'octo', handle: 'gh:octo' });
      if (req.url === '/v1/identity/challenge') return send(200, { nonce: golden.pop.nonce, expires_in: 300, sign_message: 'x' });
      if (req.url === '/v1/identity/keys') {
        seen.pop = JSON.parse(raw);
        onRegister?.(seen.pop);
        if (registerStatus !== 201) return send(registerStatus, { error: 'nope' });
        return send(201, { key_id: 'pk_issued', author_id: 'author-1', handle: 'gh:octo', signed_by_key_id: 'pk_issuer', expires_at: '2027-01-01T00:00:00Z', parent_signature_b64url: 's' });
      }
      send(404, { error: 'Not found' });
    });
  });
  return { server, seen };
}

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));

describe('login', () => {
  it('registers a locally generated key with a valid proof of possession', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const { server, seen } = stub();
    try {
      const endpoint = await listen(server);
      const out = join(dir, 'key.json');
      const { stdout } = await run('node', [TOOL, 'login', '--out', out, '--endpoint', endpoint]);
      expect(stdout).toContain('WXYZ-9876');
      expect(seen.auth.every((a) => a === 'Bearer sess')).toBe(true);

      const pub = await crypto.subtle.importKey('raw', Buffer.from(seen.pop.public_key_b64url, 'base64url'), { name: 'Ed25519' }, false, ['verify']);
      const ok = await crypto.subtle.verify('Ed25519', pub, Buffer.from(seen.pop.pop_signature_b64url, 'base64url'),
        new TextEncoder().encode(popMessage(seen.pop.nonce, seen.pop.public_key_b64url)));
      expect(ok).toBe(true);

      const key = JSON.parse(readFileSync(out, 'utf8'));
      expect(key).toMatchObject({ keyId: 'pk_issued', authorId: 'author-1', publicKeyB64Url: seen.pop.public_key_b64url });
      expect(JSON.stringify(seen.pop)).not.toContain(key.privateKeyB64Url);
      expect(statSync(out).mode & 0o777).toBe(0o600);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('never overwrites an existing key file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const { server, seen } = stub();
    try {
      const endpoint = await listen(server);
      const out = join(dir, 'key.json');
      writeFileSync(out, 'keep');
      await expect(run('node', [TOOL, 'login', '--out', out, '--endpoint', endpoint])).rejects.toThrow(/already exists/);
      expect(readFileSync(out, 'utf8')).toBe('keep');
      expect(seen.auth).toEqual([]);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('says so when self-serve publishing is not open, and leaves no key file', async () => {
    const server = createServer((_q, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"Not found"}'); });
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    try {
      const endpoint = await listen(server);
      await expect(run('node', [TOOL, 'login', '--out', join(dir, 'k.json'), '--endpoint', endpoint])).rejects.toThrow(/may not be open yet/);
      expect(existsSync(join(dir, 'k.json'))).toBe(false);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
  // Registration must never be able to succeed without a local copy of the
  // private key (otherwise the server holds a live key nobody can sign with).
  it('persists the private key (0600) before registering it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const out = join(dir, 'key.json');
    let atRegister;
    const { server } = stub({
      onRegister: (pop) => {
        atRegister = { mode: statSync(out).mode & 0o777, file: JSON.parse(readFileSync(out, 'utf8')), pub: pop.public_key_b64url };
      },
    });
    try {
      const endpoint = await listen(server);
      await run('node', [TOOL, 'login', '--out', out, '--endpoint', endpoint]);
      expect(atRegister.mode).toBe(0o600);
      expect(atRegister.file.publicKeyB64Url).toBe(atRegister.pub);
      expect(typeof atRegister.file.privateKeyB64Url).toBe('string');
      const final = JSON.parse(readFileSync(out, 'utf8'));
      expect(final.privateKeyB64Url).toBe(atRegister.file.privateKeyB64Url);
      expect(final.status).toBeUndefined();
      expect(existsSync(`${out}.partial`)).toBe(false);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not contact the registry when the key file cannot be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const { server, seen } = stub();
    try {
      const endpoint = await listen(server);
      await expect(run('node', [TOOL, 'login', '--out', join(dir, 'missing', 'key.json'), '--endpoint', endpoint]))
        .rejects.toThrow(/cannot write .*nothing was registered/);
      expect(seen.urls).toEqual([]);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('removes the key file when registration is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const out = join(dir, 'key.json');
    const { server, seen } = stub({ registerStatus: 409 });
    try {
      const endpoint = await listen(server);
      await expect(run('node', [TOOL, 'login', '--out', out, '--endpoint', endpoint])).rejects.toThrow(/register key: HTTP 409/);
      expect(seen.pop).toBeDefined();
      expect(existsSync(out)).toBe(false);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps the private key and names the issued key_id when finalizing fails after registration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const out = join(dir, 'key.json');
    // Block the final write: a directory where the tool writes `<out>.partial`.
    // Works as root too, unlike a permission-based failure.
    const { server, seen } = stub({ onRegister: () => mkdirSync(`${out}.partial`) });
    try {
      const endpoint = await listen(server);
      await expect(run('node', [TOOL, 'login', '--out', out, '--endpoint', endpoint]))
        .rejects.toThrow(/key pk_issued was issued.*retire --key-id pk_issued/s);
      const left = JSON.parse(readFileSync(out, 'utf8'));
      expect(left.publicKeyB64Url).toBe(seen.pop.public_key_b64url);
      expect(typeof left.privateKeyB64Url).toBe('string');
      expect(statSync(out).mode & 0o777).toBe(0o600);
      // A half-finished key file is refused by publish with a clear message.
      const body = join(dir, 'skill.json');
      writeFileSync(body, JSON.stringify(golden.publish[0].body));
      await expect(run('node', [TOOL, 'publish', '--key-file', out, '--body-file', body, '--dry-run']))
        .rejects.toThrow(/did not finish/);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('publish --license', () => {
  it('merges --license into the POST body but not the signed canonical payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-publish-'));
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const keyFile = {
      keyId: golden.sig.publisherKeyId,
      authorId: 'a',
      publicKeyB64Url: (await crypto.subtle.exportKey('jwk', pair.publicKey)).x,
      privateKeyB64Url: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d,
    };
    const keyPath = join(dir, 'key.json');
    writeFileSync(keyPath, JSON.stringify(keyFile));
    const bodyPath = join(dir, 'skill.json');
    const manifest = { ...golden.publish[0].body };
    delete manifest.license;
    writeFileSync(bodyPath, JSON.stringify(manifest));

    const { stdout } = await run('node', [
      TOOL,
      'publish',
      '--key-file',
      keyPath,
      '--body-file',
      bodyPath,
      '--license',
      'MIT',
      '--dry-run',
    ]);
    const out = JSON.parse(stdout);
    expect(out.body.license).toBe('MIT');
    expect(out.canonical).not.toHaveProperty('license');
    expect(Object.keys(out.canonical).sort()).toEqual(
      Object.keys(await buildCanonicalPayload(manifest, golden.sig)).sort(),
    );
  });
});
