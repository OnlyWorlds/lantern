// Joining a world with an invite link (Keel #212): https://www.onlyworlds.com/join#ow_j_…, the
// code after the #. Preview says who invites, to which world and as what (no account needed, the
// code stays unused); joining needs this phone's account token and makes the membership, then the
// world opens like any account world. A guest's Character comes back with the join.
import * as db from './db';
import { accountToken, fetchAccountWorlds, openAccountWorld, type AccountWorld } from './account';
import { API_BASE } from './world';

/** The code inside a pasted link, a shared message, or the bare code. */
export function joinCode(input: string): string | null {
  return input.match(/ow_j_[A-Za-z0-9_-]+/)?.[0] ?? null;
}

export interface JoinPreview {
  reader: 'person' | 'agent';
  world: { name: string; description?: string | null };
  invited_by: string | null;
  owner_character: string | null;
  role: 'co_builder' | 'contributor' | 'guest';
  expires_at: string;
}

/** "as a player": the role in the words the rest of Lantern uses. */
export function roleWords(role: string): string {
  return role === 'guest' ? 'a player' : role === 'co_builder' ? 'a co-builder' : 'a contributor';
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Joining needs signal.');
  }
}

async function errorOf(res: Response): Promise<{ code?: string; message?: string }> {
  const b = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return b?.error ?? {};
}

export async function previewJoin(code: string): Promise<JoinPreview> {
  const res = await post('/join/preview', { code });
  if (!res.ok) {
    const e = await errorOf(res);
    throw new Error(res.status === 404 ? 'This invite link does not work: it was used, it expired, or it was taken back. Ask for a new one.' : e.message ?? 'The invite could not be read. Try again.');
  }
  return (await res.json()) as JoinPreview;
}

/** The code waits here while the person signs in. */
export async function setPendingJoin(code: string | undefined): Promise<void> {
  await db.kvSet('pendingJoin', code);
}

export async function pendingJoin(): Promise<string | undefined> {
  return db.kvGet<string>('pendingJoin');
}

export type JoinResult = { worldId: string } | { already: true };

/** Join with this phone's account, then open the world here. */
export async function acceptJoin(code: string): Promise<JoinResult> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  const res = await post('/account/join', { code }, { Authorization: `Bearer ${token}` });
  if (res.status === 409) {
    const e = await errorOf(res);
    if (e.code === 'already_member') {
      await setPendingJoin(undefined);
      await fetchAccountWorlds(token).catch(() => undefined);
      return { already: true };
    }
    if (e.code === 'pin_required') {
      throw new Error('Set a PIN for your account on onlyworlds.com first. The link stays unused, so come back and join after.');
    }
    throw new Error(e.message ?? 'Joining did not work. Try again.');
  }
  if (res.status === 404) throw new Error('This invite link does not work: it was used, it expired, or it was taken back. Ask for a new one.');
  if (!res.ok) throw new Error((await errorOf(res)).message ?? 'Joining did not work. Try again.');
  const m = (await res.json()) as { world_id: string; world_name?: string; role?: AccountWorld['member_role']; roster_character?: string | null };
  await setPendingJoin(undefined);
  const worlds = await fetchAccountWorlds(token).catch(() => [] as AccountWorld[]);
  const w = worlds.find((x) => x.id === m.world_id) ?? { id: m.world_id, name: m.world_name ?? 'A world', role: 'collaborator', member_role: m.role };
  const rec = await openAccountWorld(w);
  if (m.roster_character) await db.updateWorldRecord(rec.id, { characterId: m.roster_character });
  return { worldId: rec.id };
}
