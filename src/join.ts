// Joining a world with an invite link (Keel #212): https://www.onlyworlds.com/join#ow_j_…, the
// code after the #. Preview says who invites, to which world and as what (no account needed, the
// code stays unused); joining needs this phone's account token and makes the membership, then the
// world opens like any account world. A guest's Character comes back with the join.
// The wire is the SDK's (4.12: previewJoin, acceptJoin, typed refusals).
import { OwApiError, OwNetworkError, OwV2Client, type OwJoinPreview } from '@onlyworlds/sdk';
import * as db from './db';
import { accountToken, adoptPlayerSeat, fetchAccountWorlds, openAccountWorld, type AccountWorld } from './account';
import { API_BASE, LANTERN_CLIENT_NAME } from './world';

export type JoinPreview = OwJoinPreview;

const DEAD = 'This invite link does not work: it was used, it expired, or it was taken back. Ask for a new one.';

/** The code inside a pasted link, a shared message, or the bare code. */
export function joinCode(input: string): string | null {
  return input.match(/ow_j_[A-Za-z0-9_-]+/)?.[0] ?? null;
}

/** "as a player": the role in the words the rest of Lantern uses. */
export function roleWords(role: string): string {
  return role === 'guest' ? 'a player' : role === 'co_builder' ? 'a co-builder' : 'a contributor';
}

function said(e: unknown, fallback: string): Error {
  if (e instanceof OwNetworkError) return new Error('No connection. Joining needs signal.');
  if (e instanceof OwApiError && e.message) return new Error(e.message);
  return new Error(fallback);
}

/** The code waits here while the person signs in. */
export async function setPendingJoin(code: string | undefined): Promise<void> {
  await db.kvSet('pendingJoin', code);
}

export async function pendingJoin(): Promise<string | undefined> {
  return db.kvGet<string>('pendingJoin');
}

export async function previewJoin(code: string): Promise<JoinPreview> {
  // previewJoin sends no credential: SDK 4.30's keyless client, as a friend with only a link has.
  const c = new OwV2Client({ baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
  try {
    return await c.previewJoin(code);
  } catch (e) {
    if (e instanceof OwApiError && e.isNotFound) {
      // A dead link is let go, or every sign-in would come back to it.
      if ((await pendingJoin()) === code) await setPendingJoin(undefined);
      throw new Error(DEAD);
    }
    throw said(e, 'The invite could not be read. Try again.');
  }
}

/** A player link (Keel #353): the preview's third reader, a friend with no account. */
export function isPlayerLink(p: JoinPreview): boolean {
  return (p.reader as string) === 'player';
}

/**
 * A table (keel #422 PR 2): a player link that seats several players, each picking a Character
 * from the owner's list. Its preview carries `max_uses`; a link for one has none of the four keys.
 */
export function isTable(p: JoinPreview): boolean {
  return typeof p.max_uses === 'number';
}

export type TablePick = { id: string; name: string; taken: boolean };

/** The owner's list in the owner's order, taken ones last (keel's note on the preview). */
export function tablePicks(p: JoinPreview): TablePick[] {
  const all = (p.characters ?? []).map((c) => ({ id: c.id, name: c.name || 'A Character', taken: !!c.taken }));
  return [...all.filter((c) => !c.taken), ...all.filter((c) => c.taken)];
}

/** A pick keel refused (taken since the preview, or no longer on the list): look again and pick anew. */
export class PickRefused extends Error {}

const LOST = 'The answer did not reach this phone. Try once more; if the link says it was used, ask for a new one: each link works once.';

/**
 * Redeem a player link with no account (Keel #353): POST /join answers 201 with a read key shown
 * once (`kind: player`). The code is spent by keel's answer, so the key is kept before anything
 * else runs. SDK 4.30's keyless client sends no credential (Kael, h29 #6169). On a table the
 * player's pick goes as `character` (keel #422 PR 2); a refusal spends nothing.
 */
export async function redeemPlayer(code: string, name?: string, table?: { character?: string }): Promise<{ worldId: string }> {
  let a;
  const opts: { name?: string; character?: string } = {};
  if (name?.trim()) opts.name = name.trim();
  if (table?.character) opts.character = table.character;
  try {
    a = await new OwV2Client({ baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).redeemJoin(code, opts);
  } catch (e) {
    if (e instanceof OwApiError && e.isNotFound) {
      if ((await pendingJoin()) === code) await setPendingJoin(undefined);
      throw new Error(table ? 'This link has no places left, or it was taken back. Ask the game master for a new one.' : DEAD);
    }
    if (e instanceof OwApiError && e.isCharacterTaken) throw new PickRefused('Someone took that Character a moment ago. Pick another.');
    if (e instanceof OwApiError && e.isCharacterInvalid) throw new PickRefused('That Character can no longer be picked. Pick another.');
    if (e instanceof OwApiError && e.status === 422 && e.param === 'name') {
      throw new Error(opts.name ? 'That name is too long: keep it under 80 characters.' : 'Type your name: your Character takes it, and the game master sees it.');
    }
    // The world's cap on players (keel PR 110, 422 world_full), from a table or a link for one.
    if (e instanceof OwApiError && e.isWorldFull) throw new Error('This world is full: it has as many players as it can seat. Ask the game master to make room.');
    // No answer: the request may have reached keel and spent the code, so say both.
    if (e instanceof OwNetworkError) throw new Error(LOST);
    throw said(e, 'Joining did not work. Try again.');
  }
  if (a.kind !== 'player') throw new Error('This link did not open as a player\'s. Ask for a new one.');
  await setPendingJoin(undefined);
  const rec = await adoptPlayerSeat({ id: a.world.id, name: a.world.name || 'A world' }, a.key, a.character.id);
  return { worldId: rec.id };
}

export type JoinResult = { worldId: string } | { already: true };

/** Join with this phone's account, then open the world here. */
export async function acceptJoin(code: string): Promise<JoinResult> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  let m;
  try {
    m = await new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).acceptJoin(code);
  } catch (e) {
    if (e instanceof OwApiError && e.isAlreadyMember) {
      await setPendingJoin(undefined);
      await fetchAccountWorlds(token).catch(() => undefined);
      return { already: true };
    }
    // Accepting needs no PIN for any role since keel #297 (ed73c90): no pin_required branch here.
    if (e instanceof OwApiError && e.isNotFound) {
      await setPendingJoin(undefined);
      throw new Error(DEAD);
    }
    throw said(e, 'Joining did not work. Try again.');
  }
  await setPendingJoin(undefined);
  const worlds = await fetchAccountWorlds(token).catch(() => [] as AccountWorld[]);
  const w: AccountWorld = worlds.find((x) => x.id === m.world_id) ?? {
    id: m.world_id,
    name: m.world_name || 'A world',
    role: 'collaborator',
    member_role: m.role as AccountWorld['member_role'],
  };
  let rec: db.WorldRecord;
  try {
    rec = await openAccountWorld(w);
  } catch {
    // The membership is made; only this phone's key for it is not. The world is in Your worlds,
    // and its Character comes back from /me when it opens there.
    throw new Error(`You are in ${w.name} now, but it did not open on this phone. Open it from Your worlds.`);
  }
  if (m.roster_character) await db.updateWorldRecord(rec.id, { characterId: m.roster_character });
  return { worldId: rec.id };
}
