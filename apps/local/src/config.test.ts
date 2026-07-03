import { describe, expect, it } from 'vitest';
import { CONFIG_ENV_VARS, ConfigError, loadConfig } from './config.js';

const REQUIRED_MIN: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/local',
  ADMIN_TOKEN: 'secret-token-value',
};

describe('loadConfig', () => {
  describe('required vars', () => {
    it('throws when DATABASE_URL is missing', () => {
      expect(() => loadConfig({ ADMIN_TOKEN: 'x' })).toThrow(ConfigError);
    });

    it('throws when ADMIN_TOKEN is missing', () => {
      expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(
        ConfigError,
      );
    });

    it('reports every missing var in one error, not just the first', () => {
      try {
        loadConfig({});
        expect.fail('expected ConfigError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const cfgErr = err as ConfigError;
        expect(cfgErr.issues.length).toBe(2);
        expect(cfgErr.issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
        expect(cfgErr.issues.some((i) => i.startsWith('ADMIN_TOKEN'))).toBe(true);
      }
    });

    it('treats whitespace-only values as missing', () => {
      expect(() =>
        loadConfig({ DATABASE_URL: '  ', ADMIN_TOKEN: '\t' }),
      ).toThrow(ConfigError);
    });
  });

  describe('defaults', () => {
    it('applies sensible defaults for optional vars', () => {
      const cfg = loadConfig(REQUIRED_MIN);
      expect(cfg.nodeEnv).toBe('development');
      expect(cfg.http.host).toBe('0.0.0.0');
      expect(cfg.http.port).toBe(3000);
      expect(cfg.postgres.poolMax).toBe(10);
      expect(cfg.postgres.statementTimeoutMs).toBe(30000);
      expect(cfg.log.level).toBe('info');
      expect(cfg.log.format).toBe('json');
      expect(cfg.log.requestIdHeader).toBe('X-Request-Id');
      expect(cfg.embedder).toEqual({
        kind: 'ollama',
        url: 'http://localhost:11434',
        model: 'nomic-embed-text',
      });
    });

    it('leaves upstream null when no upstream vars are set', () => {
      const cfg = loadConfig(REQUIRED_MIN);
      expect(cfg.upstream).toBeNull();
    });
  });

  describe('numeric parsing', () => {
    it('parses PORT', () => {
      const cfg = loadConfig({ ...REQUIRED_MIN, PORT: '8080' });
      expect(cfg.http.port).toBe(8080);
    });

    it('rejects non-numeric PORT', () => {
      expect(() => loadConfig({ ...REQUIRED_MIN, PORT: 'lol' })).toThrow(
        /PORT: must be an integer/,
      );
    });

    it('rejects PORT below min', () => {
      expect(() => loadConfig({ ...REQUIRED_MIN, PORT: '0' })).toThrow(
        ConfigError,
      );
    });

    it('rejects POSTGRES_STATEMENT_TIMEOUT_MS below 100', () => {
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, POSTGRES_STATEMENT_TIMEOUT_MS: '50' }),
      ).toThrow(/POSTGRES_STATEMENT_TIMEOUT_MS/);
    });
  });

  describe('embedder', () => {
    it('accepts upstream embedder', () => {
      const cfg = loadConfig({ ...REQUIRED_MIN, EMBEDDER: 'upstream' });
      expect(cfg.embedder.kind).toBe('upstream');
    });

    it('respects OLLAMA_URL and OLLAMA_EMBEDDING_MODEL overrides', () => {
      const cfg = loadConfig({
        ...REQUIRED_MIN,
        OLLAMA_URL: 'http://ollama:11434',
        OLLAMA_EMBEDDING_MODEL: 'mxbai-embed-large',
      });
      expect(cfg.embedder).toEqual({
        kind: 'ollama',
        url: 'http://ollama:11434',
        model: 'mxbai-embed-large',
      });
    });

    it('rejects unknown embedder kind', () => {
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, EMBEDDER: 'openai' }),
      ).toThrow(/EMBEDDER: must be ollama\|upstream/);
    });
  });

  describe('upstream', () => {
    it('populates upstream when all three vars are present', () => {
      const cfg = loadConfig({
        ...REQUIRED_MIN,
        MOTHERSHIP_URL: 'https://api.example.com',
        MOTHERSHIP_API_KEY: 'sk_test_123',
        TENANT_ID: 'tenant-a',
      });
      expect(cfg.upstream).toEqual({
        baseUrl: 'https://api.example.com',
        apiKey: 'sk_test_123',
        tenantId: 'tenant-a',
        searchFallback: true,
      });
    });

    it('fails partial upstream config', () => {
      try {
        loadConfig({
          ...REQUIRED_MIN,
          MOTHERSHIP_URL: 'https://api.example.com',
        });
        expect.fail('expected ConfigError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const cfgErr = err as ConfigError;
        expect(
          cfgErr.issues.some((i) => i.startsWith('MOTHERSHIP_API_KEY')),
        ).toBe(true);
        expect(cfgErr.issues.some((i) => i.startsWith('TENANT_ID'))).toBe(true);
      }
    });

    it('respects UPSTREAM_SEARCH_FALLBACK=false', () => {
      const cfg = loadConfig({
        ...REQUIRED_MIN,
        MOTHERSHIP_URL: 'https://api.example.com',
        MOTHERSHIP_API_KEY: 'k',
        TENANT_ID: 't',
        UPSTREAM_SEARCH_FALLBACK: 'false',
      });
      expect(cfg.upstream?.searchFallback).toBe(false);
    });

    it('rejects invalid UPSTREAM_SEARCH_FALLBACK', () => {
      expect(() =>
        loadConfig({
          ...REQUIRED_MIN,
          MOTHERSHIP_URL: 'https://api.example.com',
          MOTHERSHIP_API_KEY: 'k',
          TENANT_ID: 't',
          UPSTREAM_SEARCH_FALLBACK: 'nope',
        }),
      ).toThrow(/UPSTREAM_SEARCH_FALLBACK: must be a boolean/);
    });
  });

  describe('log level', () => {
    it('accepts valid levels', () => {
      for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
        const cfg = loadConfig({ ...REQUIRED_MIN, LOG_LEVEL: level });
        expect(cfg.log.level).toBe(level);
      }
    });

    it('rejects unknown level', () => {
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, LOG_LEVEL: 'verbose' }),
      ).toThrow(/LOG_LEVEL: must be one of/);
    });
  });

  describe('log format', () => {
    it('accepts json + pretty', () => {
      expect(loadConfig({ ...REQUIRED_MIN, LOG_FORMAT: 'json' }).log.format).toBe('json');
      expect(loadConfig({ ...REQUIRED_MIN, LOG_FORMAT: 'pretty' }).log.format).toBe('pretty');
    });

    it('rejects unknown format', () => {
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, LOG_FORMAT: 'xml' }),
      ).toThrow(/LOG_FORMAT: must be json\|pretty/);
    });
  });

  describe('log request-id header', () => {
    it('accepts a custom header name', () => {
      const cfg = loadConfig({ ...REQUIRED_MIN, LOG_REQUEST_ID_HEADER: 'X-Trace-Id' });
      expect(cfg.log.requestIdHeader).toBe('X-Trace-Id');
    });

    it('rejects header names that violate RFC 7230 tchar (space, colon)', () => {
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, LOG_REQUEST_ID_HEADER: 'X Trace Id' }),
      ).toThrow(/LOG_REQUEST_ID_HEADER: must be a valid HTTP header name/);
    });

    it('rejects header names longer than 64 chars', () => {
      const overlong = `X-${'a'.repeat(64)}`;
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, LOG_REQUEST_ID_HEADER: overlong }),
      ).toThrow(/LOG_REQUEST_ID_HEADER: must be a valid HTTP header name/);
    });
  });

  describe('node_env', () => {
    it('rejects unknown NODE_ENV', () => {
      expect(() =>
        loadConfig({ ...REQUIRED_MIN, NODE_ENV: 'staging' }),
      ).toThrow(/NODE_ENV: must be development/);
    });
  });

  describe('CONFIG_ENV_VARS', () => {
    it('enumerates every env var this module reads', () => {
      expect(CONFIG_ENV_VARS).toContain('DATABASE_URL');
      expect(CONFIG_ENV_VARS).toContain('ADMIN_TOKEN');
      expect(CONFIG_ENV_VARS).toContain('MOTHERSHIP_URL');
      expect(CONFIG_ENV_VARS).toContain('EMBEDDER');
      expect(CONFIG_ENV_VARS.length).toBeGreaterThan(10);
    });
  });
});
