import { describe, it, expect } from 'vitest';
import {
  LLMProxyCircuitOpen,
  TenantCircuitRegistry,
} from './tenant-circuit-registry.js';

describe('TenantCircuitRegistry', () => {
  it('materializes an independent breaker per tenant', () => {
    const registry = new TenantCircuitRegistry();
    const a = registry.get('tenant-a');
    const b = registry.get('tenant-b');
    expect(a).not.toBe(b);
    expect(registry.knownTenants().sort()).toEqual(['tenant-a', 'tenant-b']);
  });

  it('reuses the same breaker instance for a tenant', () => {
    const registry = new TenantCircuitRegistry();
    expect(registry.get('repeat')).toBe(registry.get('repeat'));
  });

  it('honors custom threshold and cooldown options', async () => {
    const registry = new TenantCircuitRegistry({ threshold: 1, cooldownMs: 40 });
    const breaker = registry.get('hot');
    await breaker.execute(async () => {
      throw new Error('fail');
    }, 'fb');
    expect(breaker.currentState).toBe('open');
  });

  it('resetAll clears every tracked breaker', async () => {
    const registry = new TenantCircuitRegistry({ threshold: 1, cooldownMs: 1000 });
    const breaker = registry.get('reset-me');
    await breaker.execute(async () => {
      throw new Error('fail');
    }, 'fb');
    expect(breaker.currentState).toBe('open');
    registry.resetAll();
    expect(breaker.currentState).toBe('closed');
  });
});

describe('LLMProxyCircuitOpen', () => {
  it('carries tenantId for upstream policy decisions', () => {
    const err = new LLMProxyCircuitOpen('tenant-z');
    expect(err.name).toBe('LLMProxyCircuitOpen');
    expect(err.tenantId).toBe('tenant-z');
    expect(err.message).toContain('tenant-z');
  });
});