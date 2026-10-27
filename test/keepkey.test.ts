// The phone keeps its keys (keel's mint takes `keep: true`; a revoked token's sweep passes a kept key
// by): every mint Lantern makes asks for it, and a world leaving the phone takes back the key Lantern
// made for it, by the id kept at its mint, and nothing else.
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
const session = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  sessionStorage: {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  },
});

const db = await import('../src/db');
const { openAccountWorld, takeBackDeviceKey } = await import('../src/account');

const W = '0ccc0000-0000-4000-8000-0000000000e1';
const KEY = 'ow_w_' + 'K'.repeat(28) + 'KKKK';
const KID = '0ccc0000-0000-4000-8000-0000000000f1';

const sent: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
  sent.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : {} });
  if (new Headers(init.headers).get('Authorization') !== 'Bearer ow_a_test') return json(401, { error: { code: 'invalid_credentials' } });
  if (path === `/account/worlds/${W}/keys` && method === 'POST') return json(201, { id: KID, last4: 'KKKK', name: '', revoked: false, key: KEY });
  if (path === `/account/worlds/${W}/keys/${KID}` && method === 'DELETE') return new Response(null, { status: 204 });
  return json(404, { error: { code: 'not_found' } });
}) as typeof fetch;

beforeEach(async () => {
  sent.length = 0;
  await db.removeWorld(W).catch(() => undefined);
  await db.kvSet('accountToken', 'ow_a_test');
});

describe('every mint asks keel to keep the key', () => {
  it('in the source: each POST to a world\'s keys carries KEPT', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '..', 'src'));
    let mints = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // A mint is a POST whose path ends in /keys; its body follows within the statement.
      for (const m of src.matchAll(/'POST',\s*`\/account\/worlds\/\$\{[^}]+\}\/keys`[\s\S]{0,160}?\}\s*\)/g)) {
        mints++;
        expect(m[0], `${f}: ${m[0].slice(0, 80)}`).toContain('...KEPT');
      }
    }
    expect(mints).toBe(5);
  });

  it('on the wire: opening an account world sends keep: true', async () => {
    await openAccountWorld({ id: W, name: 'Kept', role: 'owner' });
    const mint = sent.find((s) => s.method === 'POST');
    expect(mint?.body).toMatchObject({ scope: 'write', keep: true });
  });
});

describe('a world leaving the phone takes back its key', () => {
  it('by the id kept at its mint', async () => {
    const rec = await openAccountWorld({ id: W, name: 'Kept', role: 'owner' });
    sent.length = 0;
    expect(await takeBackDeviceKey(rec)).toBe(true);
    expect(sent).toEqual([{ method: 'DELETE', path: `/account/worlds/${W}/keys/${KID}`, body: {} }]);
  });
  it('never a key Lantern did not make: a key put in by hand has no mint, and nothing is sent', async () => {
    const rec = await openAccountWorld({ id: W, name: 'Kept', role: 'owner' });
    sent.length = 0;
    expect(await takeBackDeviceKey({ ...rec, apiKey: 'ow_w_' + 'P'.repeat(32), keyMint: rec.keyMint })).toBe(false);
    expect(await takeBackDeviceKey({ ...rec, keyMint: undefined })).toBe(false);
    expect(sent).toEqual([]);
  });
  it('signed out, nothing is sent', async () => {
    const rec = await openAccountWorld({ id: W, name: 'Kept', role: 'owner' });
    await db.kvSet('accountToken', undefined);
    sent.length = 0;
    expect(await takeBackDeviceKey(rec)).toBe(false);
    expect(sent).toEqual([]);
  });
});
