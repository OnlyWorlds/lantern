// Signing in: today an account token pasted from onlyworlds.com (ow_a_, sent as a Bearer token);
// when Keel #211 lands, email and password. The account lists its worlds and mints a key per
// world this phone opens, named for the phone and revocable on the portal.
import { OwV2Client, detectKeyKind, isDemoKey, type OwKeyKind } from '@onlyworlds/sdk';
import * as db from './db';
import { API_BASE } from './world';

export interface AccountWorld {
  id: string;
  name: string;
  role: 'owner' | 'collaborator';
  member_role?: 'co_builder' | 'contributor' | 'guest';
  public_read?: boolean;
}

export async function accountToken(): Promise<string | undefined> {
  return db.kvGet<string>('accountToken');
}

function accountClient(token: string): OwV2Client {
  return new OwV2Client({ apiKey: token, baseUrl: API_BASE });
}

export async function signIn(token: string): Promise<AccountWorld[]> {
  const t = token.trim();
  if (detectKeyKind(t) !== 'account') {
    throw new Error('That is not an account token. Account tokens start with ow_a_.');
  }
  const worlds = await fetchAccountWorlds(t);
  await db.kvSet('accountToken', t);
  return worlds;
}

export async function signOut(): Promise<void> {
  await db.kvSet('accountToken', undefined);
  await db.kvSet('accountWorlds', undefined);
}

export async function fetchAccountWorlds(token?: string): Promise<AccountWorld[]> {
  const t = token ?? (await accountToken());
  if (!t) return [];
  const res = await accountClient(t).request<{ data: AccountWorld[] }>('GET', '/account/worlds');
  await db.kvSet('accountWorlds', res.data);
  return res.data;
}

export async function cachedAccountWorlds(): Promise<AccountWorld[]> {
  return (await db.kvGet<AccountWorld[]>('accountWorlds')) ?? [];
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'this device';
}

/** Open an account world on this phone: mint its own key, then keep the world record. */
export async function openAccountWorld(w: AccountWorld): Promise<db.WorldRecord> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  const c = accountClient(token);
  const name = `Lantern on ${deviceName()}`;
  // Guests read; everyone else writes. A member without an account PIN gets 409 pin_required
  // on a write key, and then this phone reads until they set one on onlyworlds.com.
  let key: { key: string; scope: string };
  const scope = w.member_role === 'guest' ? 'read' : 'write';
  try {
    key = await c.request('POST', `/account/worlds/${w.id}/keys`, { body: { scope, name } });
  } catch (e) {
    if (scope === 'write' && (e as { code?: string }).code === 'pin_required') {
      key = await c.request('POST', `/account/worlds/${w.id}/keys`, { body: { scope: 'read', name } });
    } else throw e;
  }
  const rec: db.WorldRecord = {
    id: w.id,
    name: w.name,
    kind: 'online',
    apiKey: key.key,
    keyKind: detectKeyKind(key.key),
    role: w.role,
    memberRole: w.member_role,
    addedAt: new Date().toISOString(),
  };
  await db.putWorldRecord(rec);
  return rec;
}

/** Open a world with a key someone gave you (and its PIN, checked once by a read that sends it). */
export async function openWithKey(apiKey: string, pin?: string): Promise<db.WorldRecord> {
  const key = apiKey.trim();
  const kind: OwKeyKind = detectKeyKind(key);
  if (kind === 'account') throw new Error('That is an account token: use Sign in instead.');
  if (kind === 'unknown') throw new Error('That does not look like a world key (ow_w_, ow_r_, or ten digits).');
  const c = new OwV2Client({ apiKey: key, apiPin: pin || undefined, baseUrl: API_BASE });
  const meta = await c.getWorld();
  const existing = await db.getWorldRecord(meta.id);
  const rec: db.WorldRecord = {
    ...existing,
    id: meta.id,
    name: meta.name,
    kind: isDemoKey(key) ? 'demo' : 'online',
    apiKey: key,
    keyKind: kind,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  await db.putWorldRecord(rec);
  return rec;
}

export const DEMO_KEY = '0000000001';
