import { describe, expect, it } from 'vitest';
import { readIsolatedServiceConfig } from '../../tests/e2e/service-config';

describe('service browser journey configuration', () => {
  it('allows a local skip only when all service settings are absent outside CI', () => {
    expect(readIsolatedServiceConfig({})).toBeNull();
    expect(() => readIsolatedServiceConfig({ CI: 'true' })).toThrow('CI requires complete loopback-only service configuration');
  });

  it('fails closed for partial, malformed or non-loopback settings', () => {
    expect(() => readIsolatedServiceConfig({ TEST_SUPABASE_URL: 'http://127.0.0.1:54321' })).toThrow('complete loopback-only configuration');
    expect(() => readIsolatedServiceConfig({ TEST_SUPABASE_URL: 'not a URL', TEST_SUPABASE_ANON_KEY: 'anon', TEST_SUPABASE_SERVICE_KEY: 'service' })).toThrow('complete loopback-only configuration');
    expect(() => readIsolatedServiceConfig({ TEST_SUPABASE_URL: 'http://example.test', TEST_SUPABASE_ANON_KEY: 'anon', TEST_SUPABASE_SERVICE_KEY: 'service' })).toThrow('complete loopback-only configuration');
  });

  it('accepts complete loopback configuration without exposing its values in failures', () => {
    expect(readIsolatedServiceConfig({ TEST_SUPABASE_URL: 'http://127.0.0.1:54321', TEST_SUPABASE_ANON_KEY: 'synthetic-anon', TEST_SUPABASE_SERVICE_KEY: 'synthetic-service' })).toEqual({
      url: 'http://127.0.0.1:54321', anon: 'synthetic-anon', service: 'synthetic-service',
    });
    let message = '';
    try {
      readIsolatedServiceConfig({ TEST_SUPABASE_URL: 'https://example.test', TEST_SUPABASE_ANON_KEY: 'do-not-print-anon', TEST_SUPABASE_SERVICE_KEY: 'do-not-print-service' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe('Service browser journeys require complete loopback-only configuration.');
    expect(message).not.toContain('do-not-print');
  });
});
