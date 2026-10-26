import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'vite';
import { demoTarget, demoHtml, demoPublicKey, demoDeclaration } from '../demo/isolation';
import { partFields } from './contracts/inventory';
import { handleInvitation } from '../supabase/functions/organization-invite/handler';

describe('isolated synthetic demo', () => {
  it('supplies the local Edge origin and mail configuration required by the native invitation flow', async () => {
    const config = Object.fromEntries(readFileSync('demo/functions.env.example', 'utf8').trim().split(/\r?\n/).map((line) => line.split('=')));
    expect(config).toEqual({ APP_ORIGIN: 'http://127.0.0.1:5173', INVITATION_EMAIL_ENABLED: 'true' });
    const request = new Request('http://127.0.0.1:54321/functions/v1/organization-invite', { method: 'OPTIONS', headers: { Origin: config.APP_ORIGIN! } });
    const response = await handleInvitation(request, { apiUrl: demoTarget('http://127.0.0.1:54321'), publishableKey: '', appOrigin: config.APP_ORIGIN!, emailEnabled: config.INVITATION_EMAIL_ENABLED === 'true' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(config.APP_ORIGIN);
  });
  it('ships only classified synthetic identities and valid inventory inputs', () => {
    const fixture = JSON.parse(readFileSync('demo/fixtures.json', 'utf8'));
    expect(fixture.classification).toContain('SYNTHETIC DEMO');
    expect(fixture.accounts.map((account: { role: string }) => account.role)).toEqual(['owner', 'technician', 'owner']);
    expect(new Set(fixture.accounts.map((account: { email: string }) => account.email)).size).toBe(3);
    for (const account of fixture.accounts) expect(account.email).toMatch(/^demo-[a-z]+@example\.test$/);
    expect(JSON.stringify(fixture)).not.toMatch(/password|secret|token|https?:\/\//i);
    expect(partFields.parse(fixture.part)).toEqual(fixture.part);
  });
  it('allows only a local anonymous JWT and never includes rejected input in errors', () => {
    const token = (payload: unknown) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic`;
    const anon = token({ iss: 'supabase-demo', role: 'anon' });
    expect(demoPublicKey(anon)).toBe(anon);
    for (const key of [undefined, '', 'sb_secret_privileged', 'sb_publishable_unknown_origin', token({ iss: 'supabase-demo', role: 'service_role' }), token({ iss: 'supabase', role: 'anon', ref: 'private-project' }), 'invalid.jwt.value']) {
      expect(() => demoPublicKey(key)).toThrow('Use only the declared synthetic target ANON_KEY');
    }
  });
  it('pins the local target and rejects hosted, credentialed and alternate endpoints', () => {
    expect(demoTarget('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    for (const target of ['https://private.supabase.co', 'http://localhost:54321', 'http://127.0.0.1:54322', 'http://user:pass@127.0.0.1:54321', 'http://127.0.0.1:54321/path', 'http://127.0.0.1:54321?target=private']) {
      expect(() => demoTarget(target)).toThrow('Demo requires the exact isolated loopback endpoint');
    }
  });
  it('labels limitations and limits browser connections even if ambient configuration exists', () => {
    const html = demoHtml('<html><head></head><body><div id="root"></div></body></html>');
    expect(html).toContain('SYNTHETIC DEMO');
    expect(html).toContain('AI disabled');
    expect(html).toContain("connect-src http://127.0.0.1:54321;");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });
  it('requires an explicit synthetic declaration and anonymous key matching a hosted project', () => {
    const target = { classification: 'synthetic-only', apiUrl: 'https://abcdefghijklmnopqrst.supabase.co', appOrigin: 'https://demo.example.test' };
    expect(demoDeclaration(target).projectRef).toBe('abcdefghijklmnopqrst');
    for (const value of [null, { ...target, classification: 'private' }, { ...target, secret: 'never-copy' }, { ...target, apiUrl: 'https://user:password@abcdefghijklmnopqrst.supabase.co' }, { ...target, appOrigin: 'https://demo.example.test/path' }]) {
      expect(() => demoDeclaration(value)).toThrow('Invalid synthetic target declaration');
    }
    const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase', role: 'anon', ref: 'abcdefghijklmnopqrst' })).toString('base64url')}.synthetic`;
    expect(demoPublicKey(key, 'abcdefghijklmnopqrst')).toBe(key);
    expect(() => demoPublicKey(key, 'wrongprojectrefabcdefg')).toThrow();
    expect(() => demoDeclaration(JSON.parse(readFileSync('demo/target.hosted.example.json', 'utf8')))).toThrow();
  });
  it('builds only the demo target/key despite ambient private VITE values', async () => {
    const previous = { ...process.env };
    try {
      const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'anon' })).toString('base64url')}.synthetic`;
      process.env.DEMO_PUBLISHABLE_KEY = key;
      delete process.env.DEMO_TARGET_FILE;
      process.env.VITE_SUPABASE_URL = 'https://private-target.invalid';
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'private-key-sentinel';
      await build({ configFile: resolve('demo/vite.config.ts'), logLevel: 'silent' });
      const directory = '.cache/demo-dist';
      const html = readFileSync(`${directory}/index.html`, 'utf8');
      const scripts = readdirSync(`${directory}/assets`).filter((file) => file.endsWith('.js')).map((file) => readFileSync(`${directory}/assets/${file}`, 'utf8')).join('\n');
      expect(html).toContain('SYNTHETIC DEMO');
      expect(html).toContain('Content-Security-Policy');
      expect(readFileSync(`${directory}/_headers`, 'utf8')).toContain('connect-src http://127.0.0.1:54321;');
      expect(readFileSync(`${directory}/_headers`, 'utf8')).not.toContain('*.supabase.co');
      expect(scripts).toContain('http://127.0.0.1:54321');
      expect(scripts).toContain(key);
      expect(scripts).not.toMatch(/private-target\.invalid|private-key-sentinel/);
    } finally {
      for (const name of ['DEMO_PUBLISHABLE_KEY', 'DEMO_TARGET_FILE', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
        if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
      }
    }
  });
  it('generates a hosted synthetic artifact and matching headers without contacting the invented target', async () => {
    const previous = { ...process.env };
    const file = `.cache/demo-target-test-${randomUUID()}.json`;
    const target = { classification: 'synthetic-only', apiUrl: 'https://abcdefghijklmnopqrst.supabase.co', appOrigin: 'https://demo.example.test' };
    mkdirSync('.cache', { recursive: true });
    writeFileSync(file, JSON.stringify(target), { flag: 'wx' });
    try {
      process.env.DEMO_TARGET_FILE = file;
      process.env.DEMO_PUBLISHABLE_KEY = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase', role: 'anon', ref: 'abcdefghijklmnopqrst' })).toString('base64url')}.synthetic`;
      await build({ configFile: resolve('demo/vite.config.ts'), build: { outDir: '.cache/demo-hosted-dist' }, logLevel: 'silent' });
      const headers = readFileSync('.cache/demo-hosted-dist/_headers', 'utf8');
      expect(headers).toContain(`connect-src ${target.apiUrl};`);
      expect(headers).not.toContain('127.0.0.1');
      expect(headers).not.toContain('*.supabase.co');
      expect(readFileSync('.cache/demo-hosted-dist/index.html', 'utf8')).toContain(`connect-src ${target.apiUrl};`);
      const scripts = readdirSync('.cache/demo-hosted-dist/assets').filter((name) => name.endsWith('.js')).map((name) => readFileSync(`.cache/demo-hosted-dist/assets/${name}`, 'utf8')).join('\n');
      expect(scripts).toContain(target.apiUrl);
      expect(scripts).not.toContain('http://127.0.0.1:54321');
    } finally {
      unlinkSync(file);
      for (const name of ['DEMO_TARGET_FILE', 'DEMO_PUBLISHABLE_KEY']) {
        if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
      }
    }
  });
});
