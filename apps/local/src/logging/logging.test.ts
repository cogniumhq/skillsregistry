import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';

import {
  adaptToPortLogger,
  createLogger,
  createSilentLogger,
} from './index.js';
import type { LogConfig } from '../config.js';

function captureStream(): { stream: Writable; lines: unknown[] } {
  const lines: unknown[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString('utf8').trim();
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        try {
          lines.push(JSON.parse(line));
        } catch {
          lines.push(line);
        }
      }
      cb();
    },
  });
  return { stream, lines };
}

const baseConfig: LogConfig = {
  level: 'info',
  format: 'json',
  requestIdHeader: 'X-Request-Id',
};

describe('createLogger (T-2.15)', () => {
  it('creates a pino logger honoring the configured level', () => {
    const logger = createLogger({ ...baseConfig, level: 'warn' });
    expect(logger.level).toBe('warn');
  });

  it('json format is the production path (no transport shell-out)', () => {
    // Sanity: instantiating in json mode must not throw at construction.
    const logger = createLogger({ ...baseConfig, format: 'json' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('silent logger discards every event and reports level="silent"', () => {
    const logger = createSilentLogger();
    expect(logger.level).toBe('silent');
    // Should not throw regardless of what is logged.
    logger.info({ foo: 1 }, 'ignored');
    logger.error({ err: 'x' }, 'also ignored');
  });
});

describe('adaptToPortLogger (T-2.15)', () => {
  it('flips pino arg order — port emits (message, meta) → pino sees (meta, message)', () => {
    const { stream, lines } = captureStream();
    const port = adaptToPortLogger(pino({ level: 'info' }, stream));

    port.info('user event', { userId: 42, action: 'click' });

    expect(lines).toHaveLength(1);
    const entry = lines[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      msg: 'user event',
      userId: 42,
      action: 'click',
      level: 30, // pino 'info' numeric
    });
  });

  it('warn + error map to the correct pino levels', () => {
    const { stream, lines } = captureStream();
    const port = adaptToPortLogger(pino({ level: 'trace' }, stream));

    port.warn('slow query', { ms: 1200 });
    port.error('upstream 503', { url: '/x' });

    expect(lines).toHaveLength(2);
    expect((lines[0] as { level: number }).level).toBe(40); // warn
    expect((lines[1] as { level: number }).level).toBe(50); // error
    expect((lines[0] as { msg: string }).msg).toBe('slow query');
    expect((lines[1] as { msg: string }).msg).toBe('upstream 503');
  });

  it('meta is optional — omitting it still emits a valid entry', () => {
    const { stream, lines } = captureStream();
    const port = adaptToPortLogger(pino({ level: 'info' }, stream));

    port.info('bare message');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'bare message', level: 30 });
  });

  it('inherits child-logger bindings — module label survives adaptation', () => {
    const { stream, lines } = captureStream();
    const root = pino({ level: 'info' }, stream);
    const port = adaptToPortLogger(root.child({ module: 'trust-client' }));

    port.info('kv miss', { key: 'trust:budget:v1:acme' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: 'kv miss',
      module: 'trust-client',
      key: 'trust:budget:v1:acme',
    });
  });
});
