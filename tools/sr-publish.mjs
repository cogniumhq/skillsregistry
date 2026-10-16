#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// sr-publish.mjs — publish skills to SkillsRegistry as a verified publisher
// ════════════════════════════════════════════════════════════════════════════
//
// Single file, no dependencies, Node >= 20. Download and run:
//
//   curl -fsSLO https://raw.githubusercontent.com/cogniumhq/skillsregistry/main/tools/sr-publish.mjs
//   node sr-publish.mjs login --out my-key.json
//   node sr-publish.mjs publish --key-file my-key.json --body-file skill.json
//
// `login` proves a GitHub account (device code), generates an Ed25519 key on
// THIS machine and has the registry issue it. The private key never leaves the
// machine: the registry only sees the public key and a signature over a
// one-time challenge. `publish` signs the skill manifest with that key.
//
// Canonical forms are byte-for-byte those the registry verifies (RFC 8785 JCS;
// see tools/sr-publish.test.mjs, which pins them against vectors produced by
// the registry's own code). If you port this to another language, port the
// tests too: any drift is rejected as `bad_sig`.
//
// ════════════════════════════════════════════════════════════════════════════

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit, stdout, stderr } from 'node:process';
import { pathToFileURL } from 'node:url';

// Writes live on the workers.dev host; api.skillsregistry.net is read-only.
export const DEFAULT_ENDPOINT = 'https://skillsregistry.cognium.workers.dev';
export const CANONICAL_VERSION = 1;

const subtle = globalThis.crypto.subtle;

// ── Encoding ────────────────────────────────────────────────────────────────

export const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const hex = (bytes) => Buffer.from(bytes).toString('hex');

async function sha256Hex(bytes) {
  return hex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
}

// RFC 8785 JSON Canonicalization Scheme. Object keys sorted by UTF-16 code
// units; primitives serialised exactly as ECMAScript JSON.stringify does
// (which is what JCS specifies for numbers and strings).
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      throw new Error('canonicalize: value is not representable in JSON');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('canonicalize: non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',') + ']';
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

const sortAscending = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ── Canonical publish payload (X-Skill-* signature) ─────────────────────────

export async function computeContentHash({ skillMd, mcpUrl }) {
  return sha256Hex(new TextEncoder().encode((skillMd ?? '') + '\n' + (mcpUrl ?? '')));
}

function freezeAgentProfile(p) {
  const base = {
    memoryMb: p.memoryMb,
    cpu: p.cpu,
    timeoutSeconds: p.timeoutSeconds,
    budgetCaps: { maxTokensUsd: p.budgetCaps.maxTokensUsd, maxInternalToolCalls: p.budgetCaps.maxInternalToolCalls },
  };
  if (p.egress) base.egress = sortAscending(p.egress);
  return base;
}

export async function buildCanonicalPayload(body, { publisherKeyId, signedAt, nonce }) {
  const runtimeEnv = body.runtimeEnv ?? 'api';
  const payload = {
    canonical_version: CANONICAL_VERSION,
    name: body.name,
    slug: body.slug,
    version: body.version ?? '1.0.0',
    description: body.description,
    content_hash: await computeContentHash(body),
    runtime_env: runtimeEnv,
    execution_layer: body.executionLayer,
    tags: sortAscending(body.tags ?? []),
    capabilities_required: sortAscending(body.capabilitiesRequired ?? []),
    publisher_key_id: publisherKeyId,
    signed_at: signedAt,
    nonce,
  };
  if (runtimeEnv === 'agent') {
    if (!body.agentProfile) throw new Error("agentProfile is required when runtimeEnv is 'agent'");
    payload.agent_profile = freezeAgentProfile(body.agentProfile);
  }
  return payload;
}

// ── Canonical per-skill request (X-Request-* signature) ─────────────────────

export async function buildCanonicalRequest({ method, path, body, keyId, signedAt, nonce }) {
  return {
    canonical_version: CANONICAL_VERSION,
    kind: 'request',
    method: method.toUpperCase(),
    path,
    body_sha256: await sha256Hex(body),
    key_id: keyId,
    signed_at: signedAt,
    nonce,
  };
}

/** The exact message signed to prove possession of a key being registered. */
export const popMessage = (nonce, publicKeyB64Url) => `sr-identity-pop:v1:${nonce}:${publicKeyB64Url}`;

// ── Keys ────────────────────────────────────────────────────────────────────

export async function importSigningKey(file) {
  return subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', d: file.privateKeyB64Url, x: file.publicKeyB64Url },
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

export async function sign(key, text) {
  return b64url(new Uint8Array(await subtle.sign('Ed25519', key, new TextEncoder().encode(text))));
}

async function readKeyFile(path) {
  const k = JSON.parse(await readFile(path, 'utf8'));
  for (const f of ['keyId', 'authorId', 'publicKeyB64Url', 'privateKeyB64Url']) {
    if (typeof k[f] !== 'string' || !k[f]) throw new Error(`key file ${path} is missing ${f}`);
  }
  return k;
}

// RFC 3339 UTC, no fractional seconds — what the registry expects.
const nowRfc3339 = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function signPublish(keyFile, body, meta = {}) {
  const signedAt = meta.signedAt ?? nowRfc3339();
  const nonce = meta.nonce ?? globalThis.crypto.randomUUID();
  const canonical = await buildCanonicalPayload(body, { publisherKeyId: keyFile.keyId, signedAt, nonce });
  const signature = await sign(await importSigningKey(keyFile), canonicalize(canonical));
  return {
    canonical,
    headers: {
      'X-Skill-Signature': signature,
      'X-Skill-Key-Id': keyFile.keyId,
      'X-Skill-Signed-At': signedAt,
      'X-Skill-Nonce': nonce,
    },
  };
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function call(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, body };
}

function apiError(step, r) {
  if (r.status === 404 && r.body?.error === 'Not found') {
    return new Error(`${step}: not available on this endpoint (HTTP 404) — self-serve publishing may not be open yet`);
  }
  const b = typeof r.body === 'object' && r.body ? r.body : {};
  return new Error(`${step}: HTTP ${r.status} ${b.error ?? ''}${b.detail ? ` — ${b.detail}` : ''}`.trim());
}

async function deviceLogin(endpoint) {
  const start = await call(`${endpoint}/v1/identity/device/start`, { method: 'POST' });
  if (start.status !== 200) throw apiError('login', start);
  const { device_code, user_code, verification_uri, expires_in } = start.body;
  let interval = Number.isFinite(Number(start.body.interval)) ? Number(start.body.interval) : 5;
  stdout.write(`\nOpen ${verification_uri} and enter the code:  ${user_code}\nWaiting for approval…\n`);

  const deadline = Date.now() + (Number(expires_in) || 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const poll = await call(`${endpoint}/v1/identity/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code }),
    });
    if (poll.status === 202) {
      if (poll.body?.slow_down) interval += 5; // RFC 8628 §3.5
      continue;
    }
    if (poll.status !== 200) throw apiError('login', poll);
    stdout.write(`Logged in as ${poll.body.login} (${poll.body.handle})\n`);
    return poll.body.session;
  }
  throw new Error('login: the code expired before it was approved — run login again');
}

// ── Commands ────────────────────────────────────────────────────────────────

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) flags[args[i].slice(2)] = true;
    else { flags[args[i].slice(2)] = next; i++; }
  }
  return flags;
}

function need(flags, k) {
  if (typeof flags[k] !== 'string' || !flags[k]) throw new Error(`missing --${k}`);
  return flags[k];
}

const endpointOf = (flags) => String(flags.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '');

async function cmdLogin(flags) {
  const endpoint = endpointOf(flags);
  const out = need(flags, 'out');
  // Refuse to overwrite: the file may hold the only copy of a live key.
  const exists = await readFile(out).then(() => true, (e) => (e.code === 'ENOENT' ? false : Promise.reject(e)));
  if (exists) throw new Error(`${out} already exists — choose another --out (it may hold your only copy of a key)`);

  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = (await subtle.exportKey('jwk', pair.publicKey)).x;
  const priv = (await subtle.exportKey('jwk', pair.privateKey)).d;

  const session = await deviceLogin(endpoint);
  const auth = { authorization: `Bearer ${session}` };
  const chal = await call(`${endpoint}/v1/identity/challenge`, { headers: auth });
  if (chal.status !== 200) throw apiError('challenge', chal);
  const nonce = String(chal.body.nonce);

  const reg = await call(`${endpoint}/v1/identity/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ public_key_b64url: pub, nonce, pop_signature_b64url: await sign(pair.privateKey, popMessage(nonce, pub)) }),
  });
  if (reg.status !== 201) throw apiError('register key', reg);

  const keyFile = { keyId: reg.body.key_id, authorId: reg.body.author_id, publicKeyB64Url: pub, privateKeyB64Url: priv };
  await writeFile(out, JSON.stringify(keyFile, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  stdout.write(
    `\nKey ${reg.body.key_id} issued to ${reg.body.handle} (expires ${reg.body.expires_at}).\n` +
      `Wrote ${out}. It holds your PRIVATE key: back it up, never commit it.\n` +
      `Lost it? Run \`retire --key-id ${reg.body.key_id}\`, then \`login\` again. Skills you already published stay verified.\n`,
  );
}

async function cmdWhoami(flags) {
  const endpoint = endpointOf(flags);
  const session = await deviceLogin(endpoint);
  const me = await call(`${endpoint}/v1/identity/me`, { headers: { authorization: `Bearer ${session}` } });
  if (me.status !== 200) throw apiError('whoami', me);
  stdout.write(JSON.stringify(me.body, null, 2) + '\n');
}

async function cmdRetire(flags) {
  const endpoint = endpointOf(flags);
  const keyId = need(flags, 'key-id');
  const session = await deviceLogin(endpoint);
  const r = await call(`${endpoint}/v1/identity/keys/${encodeURIComponent(keyId)}/retire`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session}` },
  });
  if (r.status === 404) throw new Error(`retire: no active key ${keyId} for this GitHub account`);
  if (r.status !== 200) throw apiError('retire', r);
  stdout.write(`Retired ${r.body.key_id} at ${r.body.retired_at}. It can sign nothing new.\n`);
}

async function cmdPublish(flags) {
  const key = await readKeyFile(need(flags, 'key-file'));
  const body = JSON.parse(await readFile(need(flags, 'body-file'), 'utf8'));
  const { headers, canonical } = await signPublish(key, body);
  if (flags['dry-run']) {
    stdout.write(JSON.stringify({ headers, canonical }, null, 2) + '\n');
    return;
  }
  const r = await call(`${endpointOf(flags)}/v1/skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const warn = r.headers.get('x-signature-warning');
  if (warn) stderr.write(`warning: signature not accepted (${warn})\n`);
  if (r.status !== 201) throw apiError('publish', r);
  stdout.write(
    `Published ${r.body.slug}@${r.body.version} (id ${r.body.id}).\n` +
      `It is listed as pending trust until the registry's scan completes.\n`,
  );
}

async function cmdRequest(flags) {
  const key = await readKeyFile(need(flags, 'key-file'));
  const method = need(flags, 'method').toUpperCase();
  const path = need(flags, 'path');
  if (!path.startsWith('/v1/skills/')) throw new Error('--path must be a per-skill route under /v1/skills/');
  let body = new Uint8Array();
  let contentType = 'application/json';
  if (typeof flags['body-file'] === 'string') {
    body = new TextEncoder().encode(JSON.stringify(JSON.parse(await readFile(flags['body-file'], 'utf8'))));
  } else if (typeof flags['raw-file'] === 'string') {
    body = new Uint8Array(await readFile(flags['raw-file']));
    contentType = typeof flags['content-type'] === 'string' ? flags['content-type'] : 'application/gzip';
  }
  const signedAt = nowRfc3339();
  const nonce = globalThis.crypto.randomUUID();
  const canonical = await buildCanonicalRequest({ method, path, body, keyId: key.keyId, signedAt, nonce });
  const headers = {
    'x-request-signature': await sign(await importSigningKey(key), canonicalize(canonical)),
    'x-request-key-id': key.keyId,
    'x-request-signed-at': signedAt,
    'x-request-nonce': nonce,
  };
  if (flags['dry-run']) {
    stdout.write(JSON.stringify({ headers, canonical }, null, 2) + '\n');
    return;
  }
  const r = await call(`${endpointOf(flags)}${path}`, {
    method,
    headers: { 'content-type': contentType, ...headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
  stdout.write(`HTTP ${r.status}\n${typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2)}\n`);
  if (r.status >= 400) exit(1);
}

const HELP = `sr-publish.mjs — publish to SkillsRegistry as a verified publisher

  login   --out FILE              Log in with GitHub; create and register a key (written to FILE, mode 600)
  whoami                          Log in and list the keys on your GitHub account
  retire  --key-id pk_xxx         Lost key: stop it signing anything new (past publishes stay verified)
  publish --key-file FILE --body-file skill.json [--dry-run]
                                  Sign and publish a skill manifest
  request --key-file FILE --method M --path /v1/skills/<id>/... [--body-file F.json | --raw-file F] [--dry-run]
                                  Signed change to a skill you own (status, scope, bundle, …)

  All commands take --endpoint URL (default ${DEFAULT_ENDPOINT}).
  Docs: https://skillsregistry.net/publish
`;

async function main() {
  const [cmd, ...rest] = argv.slice(2);
  const flags = parseFlags(rest);
  const commands = { login: cmdLogin, whoami: cmdWhoami, retire: cmdRetire, publish: cmdPublish, request: cmdRequest };
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return void stdout.write(HELP);
  if (!commands[cmd]) {
    stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
    exit(2);
  }
  await commands[cmd](flags);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err) => {
    stderr.write(`error: ${err.message ?? err}\n`);
    exit(1);
  });
}
