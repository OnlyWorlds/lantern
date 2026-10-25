// Signing in: email (or username) and password through the SDK's signInWithPassword (Keel #211),
// which gives this phone an account token of its own; a token pasted from onlyworlds.com still
// works behind "I have an account token" (ow_a_, sent as a Bearer token). The account lists its
// worlds and mints a key per world this phone opens, named for the phone and revocable on the portal.
import { OwV2Client, OwSignInError, detectKeyKind, isDemoKey, kindCanWrite, type OwKeyKind } from '@onlyworlds/sdk';
import * as db from './db';
import { API_BASE, LANTERN_CLIENT_NAME, forgetSession } from './world';
import { plural } from './dom';
import { forgetAccountPin, setPin } from './pin';
import { clearNotes } from './notes';
import { mintOf, mintedTokenId, revokeToken, type RevokeOutcome, type TokenMint } from './revoke';

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
  return new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
}

export interface AccountWho {
  id: string;
  username: string;
}

/** Which account a token is: keel's profile (`GET /account`, id and username). */
export async function whoAmI(token: string): Promise<AccountWho> {
  const res = await accountClient(token).request<{ id?: string; username?: string; data?: { id?: string; username?: string } }>('GET', '/account');
  const p = res.data ?? res;
  if (typeof p.id !== 'string' || !p.id) throw new Error('OnlyWorlds did not say which account this is. Try again.');
  return { id: p.id, username: typeof p.username === 'string' ? p.username : '' };
}

/** The name of the account this phone is signed in as, when it knows it. */
export async function accountName(): Promise<string | undefined> {
  if (!(await accountToken())) return undefined;
  return (await db.kvGet<string>('accountName')) || undefined;
}

/** The SDK's record of a Sign in with OnlyWorlds under way (src/signin.ts): no attempt outlives a sign-in or a sign-out. */
const HANDOFF_RECORD = 'ow_signin:lantern';
function dropHandoffRecord(): void {
  try {
    localStorage.removeItem(HANDOFF_RECORD);
  } catch {
    /* storage refused */
  }
}

/** Set when a sign-in is kept, so another window of this browser hears it (a `storage` event; the S470 code gate's C5). */
export const SIGNED_IN_SIGNAL = 'lantern-signed-in';

/**
 * Keep a sign-in, by any door (the password, a pasted token, Sign in with OnlyWorlds). The token is
 * written first (the S470 code gate's C10). Another account than the one this phone last knew holds
 * the old account's role aside on the worlds it opened (the S470 gate's G6): they stay on the phone as
 * worlds opened with a key, each with its own key and PIN, and the role comes back when that account
 * signs in again (the code gate's C1). A world's `memberRole` is its key's and stays (C3); an open
 * session is dropped, so nothing in memory keeps the old role (C2). The account id is written last,
 * so a sign-in cut off midway is redone by the next, which still sees the old id. A phone that never
 * kept an account id counts as unknown, never as another account (`fetchAccountWorlds` backfills it).
 * `tokenId` is keel's id for a token Lantern minted (src/revoke.ts), kept with the token's tail right
 * after it; a pasted token has none, and its write clears the old one's.
 */
export async function keepAccount(token: string, who: AccountWho, tokenId?: string | null): Promise<void> {
  await db.kvSet('accountToken', token);
  await db.kvSet('accountTokenMint', mintOf(token, tokenId));
  const before = await db.kvGet<string>('accountId');
  if (before && before !== who.id) {
    await db.kvSet('accountWorlds', undefined);
    forgetAccountPin();
    for (const w of await db.listWorlds()) {
      if (w.role) {
        await db.updateWorldRecord(w.id, { role: undefined, heldRole: w.role, heldBy: before });
        forgetSession(w.id);
      } else if (w.heldBy === who.id && w.heldRole) {
        await db.updateWorldRecord(w.id, { role: w.heldRole, heldRole: undefined, heldBy: undefined });
        forgetSession(w.id);
      }
    }
  }
  await db.kvSet('accountName', who.username);
  await db.kvSet('accountId', who.id);
  dropHandoffRecord();
  try {
    localStorage.setItem(SIGNED_IN_SIGNAL, String(Date.now()));
  } catch {
    /* storage refused: the other window learns it on its next return to the front */
  }
}

export async function signIn(token: string, tokenId?: string | null): Promise<AccountWorld[]> {
  const t = token.trim();
  if (detectKeyKind(t) !== 'account') {
    throw new Error('That is not an account token. Account tokens start with ow_a_.');
  }
  // The profile both checks the token and says which account it is.
  const who = await whoAmI(t);
  await keepAccount(t, who, tokenId);
  // Kept: a list that fails to arrive is asked again on Your worlds, never a failed sign-in (the
  // code gate's C4: a retry would mint a second token).
  return fetchAccountWorlds(t).catch(() => cachedAccountWorlds());
}

/** What to tell someone for each refused sign-in. Never keel's raw text. */
export function signInRefusal(err: unknown): string {
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'invalid_credentials': return 'That email or username and password did not match an OnlyWorlds account.';
      case 'email_unverified': return 'Confirm your email first: the link is in the mail onlyworlds.com sent you.';
      case 'rate_limited': return 'Too many tries. Wait a moment and try again.';
      case 'offline': return 'No connection. Signing in needs signal.';
      case 'mint_failed': return "This phone's token could not be made. Try again.";
    }
  }
  return 'Signing in did not work. Try again.';
}

/**
 * Keel #211, through the SDK (4.31's `signInWithPassword`, Boss's flag h11 #6858; Atlas 1.52 signs
 * in the same way): an email or a username and the password become this phone's own account token,
 * named for the phone and revocable on the portal; the session ends inside the call, and only the
 * token is kept.
 */
export async function signInWithPassword(login: string, password: string): Promise<AccountWorld[]> {
  const id = login.trim();
  let token: string;
  let tokenId: string;
  try {
    const signed = await new OwV2Client({ baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).signInWithPassword({
      ...(id.includes('@') ? { email: id } : { username: id }),
      password,
      tokenName: `Lantern on ${deviceName()}`,
    });
    token = signed.token;
    tokenId = signed.id;
  } catch (err) {
    throw new Error(signInRefusal(err));
  }
  try {
    return await signIn(token, tokenId);
  } catch (err) {
    // Not awaited: the refusal is said now, not after keel answers (the S476 gate's S2); keepalive carries it.
    void revokeIfNotKept(token, tokenId);
    throw err;
  }
}

/**
 * A token Lantern minted that the phone did not keep (the profile call after the mint failed, or
 * the keep itself) is a live bearer nobody holds: revoked at once by its id, quietly. A token that
 * did land in `kv` is never touched here.
 */
export async function revokeIfNotKept(token: string, tokenId: string | null | undefined): Promise<void> {
  if (!tokenId) return;
  let held: string | undefined;
  try {
    held = await accountToken();
  } catch {
    // The store did not answer: the token may have landed, so it is left alone (the S476 gate's S1).
    return;
  }
  if (held === token) return;
  await revokeToken(token, tokenId);
}

/**
 * Sign out: the phone lets go first (the token, its mint record, a waiting invite, the PIN), so the
 * sign-out holds offline; then a token Lantern minted is revoked on onlyworlds.com with the copy
 * held here (S476). `revoking` is the revoke's outcome, to say once it lands (wrapped, so awaiting
 * the sign-out never waits on keel); null when there is nothing Lantern may revoke (a pasted token,
 * or one kept before mint records). The revoke never writes the app database.
 */
export async function signOut(): Promise<{ revoking: Promise<RevokeOutcome> | null }> {
  const token = await accountToken();
  const tokenId = mintedTokenId(token, await db.kvGet<TokenMint>('accountTokenMint'));
  await db.kvSet('accountToken', undefined);
  // Sent the moment the phone has let go, so a later step that fails cannot strand it (the S476 gate's S4).
  const revoking = token && tokenId ? revokeToken(token, tokenId) : null;
  await db.kvSet('accountTokenMint', undefined);
  // An invite waiting for this account is not the next account's.
  await db.kvSet('pendingJoin', undefined);
  await db.kvSet('accountWorlds', undefined);
  forgetAccountPin();
  // The account id stays, so the next sign-in can tell whether it is the same account.
  dropHandoffRecord();
  return { revoking };
}

export const TOKEN_MAY_WORK = "Lantern's token may still work: remove it on onlyworlds.com in Account settings under Account tokens.";

/** What Sign out says once the revoke has answered (`rest`: what happened to the worlds on the phone). */
export function signedOutLine(outcome: RevokeOutcome | null, rest: string): string {
  if (outcome === 'kept') return `Signed out here. ${rest} ${TOKEN_MAY_WORK}`;
  return outcome === 'revoked' ? `Signed out. Lantern's token is revoked on OnlyWorlds. ${rest}` : `Signed out. ${rest}`;
}

export async function fetchAccountWorlds(token?: string): Promise<AccountWorld[]> {
  const t = token ?? (await accountToken());
  if (!t) return [];
  const res = await accountClient(t).request<{ data: AccountWorld[] }>('GET', '/account/worlds');
  await db.kvSet('accountWorlds', res.data);
  // A phone signed in before accounts were kept by id learns its own, once, so its next switch is
  // known (the S470 code gate's C7). Quiet: a failure only means asking again next time.
  if (!token && !(await db.kvGet<string>('accountId'))) {
    void whoAmI(t)
      .then(async (who) => {
        if ((await accountToken()) !== t || (await db.kvGet<string>('accountId'))) return;
        await db.kvSet('accountName', who.username);
        await db.kvSet('accountId', who.id);
      })
      .catch(() => undefined);
  }
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

/**
 * A world already on this phone, opened again under another key (a player joining on the game
 * master's phone, a second member's key): what the old key saw and queued is not this key's (the
 * security pass, 2026-10-13, F1). Changes still waiting are refused, never sent under another key;
 * otherwise the copy goes, and the world is read afresh with the new key.
 */
async function takeOver(existing: db.WorldRecord | undefined, key?: string): Promise<boolean> {
  if (!existing || (key !== undefined && existing.apiKey === key)) return false;
  const waiting = (await db.outboxRows(existing.id)).length;
  if (waiting) {
    throw new Error(
      `${existing.name} is on this phone with ${plural(waiting, 'change')} not sent yet. Send ${waiting === 1 ? 'it' : 'them'}, or remove the world from this phone, before opening it another way.`,
    );
  }
  forgetSession(existing.id);
  // A player's notes are the old key holder's (the S406 gate, G4): they go with the copy, so the
  // next holder can neither read nor share them.
  clearNotes(existing.id);
  await db.clearElements(existing.id);
  // Where the old key's walk stood goes with its copy: if what follows fails (the new key's mint),
  // the world reads again from zero, never from a cursor past pages it no longer holds (the S402
  // gate, G1). The world's own PIN goes too: it was the old key holder's (G6).
  await db.updateWorldRecord(existing.id, { cursor: undefined, appliedHead: undefined, appliedEpoch: undefined, count: undefined, lastSync: undefined });
  if (!existing.role) setPin({ id: existing.id }, undefined);
  return true;
}

/** Open an account world on this phone: mint its own key, then keep the world record. */
export async function openAccountWorld(w: AccountWorld): Promise<db.WorldRecord> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  // Before a key is minted: a refusal leaves nothing behind on keel.
  await takeOver(await db.getWorldRecord(w.id));
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
  if (readsForWantOfPin(rec)) {
    try { sessionStorage.setItem(NO_PIN_MARK + rec.id, '1'); } catch { /* said on the pill anyway */ }
  }
  return rec;
}

/** A member's world that opened to read because their account had no PIN then (409 pin_required). */
export function readsForWantOfPin(rec: db.WorldRecord): boolean {
  return rec.kind === 'online' && !!rec.role && rec.role !== 'owner' && !!rec.memberRole && rec.memberRole !== 'guest'
    && !!rec.apiKey && detectKeyKind(rec.apiKey) === 'read';
}

const NO_PIN_MARK = 'lantern:no-pin-said:';

/** True once per world opened to read for want of a PIN: the home says so the first time. */
export function takeNoPinMark(worldId: string): boolean {
  try {
    if (!sessionStorage.getItem(NO_PIN_MARK + worldId)) return false;
    sessionStorage.removeItem(NO_PIN_MARK + worldId);
    return true;
  } catch {
    return false;
  }
}

export const NO_PIN_YET ='Your account has no PIN yet. Set one on onlyworlds.com, in Account settings under World PIN, then try again.';

/**
 * Once the member has set a PIN: a write key in place of the read one (#294's walk). The read key
 * is taken back when keel lists it, so the member's keys page keeps one key per phone.
 */
export async function upgradeMemberKey(rec: db.WorldRecord): Promise<void> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  const c = accountClient(token);
  let key: { key: string };
  try {
    key = await c.request('POST', `/account/worlds/${rec.id}/keys`, { body: { scope: 'write', name: `Lantern on ${deviceName()}` } });
  } catch (e) {
    if ((e as { code?: string }).code === 'pin_required') throw new Error(NO_PIN_YET);
    throw e;
  }
  const old = rec.apiKey ?? '';
  await db.updateWorldRecord(rec.id, { apiKey: key.key, keyKind: detectKeyKind(key.key) });
  forgetSession(rec.id);
  try {
    const listed = await c.request<{ data: Array<{ id: string; last4: string; scope: string }> }>('GET', `/account/worlds/${rec.id}/keys`);
    const gone = listed.data.find((k) => k.scope === 'READ' && old.endsWith(k.last4));
    if (gone) await c.request('DELETE', `/account/worlds/${rec.id}/keys/${gone.id}`);
  } catch {
    // The read key stays listed on the member's keys page; it opens nothing more than the world did.
  }
}

/**
 * A world whose key keel refuses takes a new one in place (Atlas #198's twin, S418): the copy, its
 * cursor and the changes waiting stay; only the key and its kind change, and the session opens
 * again on it. Never "open it again", which drops the copy (`takeOver`).
 *
 * Made from the account: signed in, for a world on the account's list. A guest gets a read key; a
 * member with no PIN yet a read key too (keel's 409 pin_required), which still beats a dead one.
 * A world not on the list is said as gone only when keel said it no longer knows the key.
 */
export async function renewWorldKey(rec: db.WorldRecord, cause: 'key_revoked' | 'key_unknown' | 'read_only_key' | null): Promise<{ readOnly: boolean }> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first, or put in a key from the world\'s page on onlyworlds.com.');
  const listed = (await fetchAccountWorlds(token)).find((w) => w.id === rec.id);
  if (!listed) {
    throw new Error(cause === 'key_unknown'
      ? `${rec.name} is no longer on your OnlyWorlds account: it was deleted there, or you were removed from it. What is on this phone stays.`
      : `${rec.name} is not on the account this phone is signed in to, so Lantern can't make its key. Put in a key from the world's page on onlyworlds.com.`);
  }
  const c = accountClient(token);
  const mint = (scope: 'write' | 'read') => c.request<{ key: string }>('POST', `/account/worlds/${rec.id}/keys`, { body: { scope, name: `Lantern on ${deviceName()}` } });
  let key: { key: string };
  if (listed.member_role === 'guest') key = await mint('read');
  else {
    try {
      key = await mint('write');
    } catch (e) {
      if ((e as { code?: string }).code !== 'pin_required' || listed.role === 'owner') throw e;
      key = await mint('read');
    }
  }
  const kind = detectKeyKind(key.key);
  await db.updateWorldRecord(rec.id, { apiKey: key.key, keyKind: kind, role: listed.role, memberRole: listed.member_role });
  forgetSession(rec.id);
  return { readOnly: !kindCanWrite(kind) };
}

/**
 * Put in a key someone gave you, in place (Atlas #198's twin): read once against keel, and it must
 * open this world. The copy and its waiting changes stay.
 */
export async function putKeyInPlace(rec: db.WorldRecord, apiKey: string, pin?: string): Promise<void> {
  const key = apiKey.trim();
  const kind: OwKeyKind = detectKeyKind(key);
  if (!key) throw new Error('Paste the key first.');
  if (kind === 'account') throw new Error('That is an account token: use Sign in instead.');
  if (kind === 'unknown') throw new Error('That does not look like a world key (ow_w_, ow_r_, or ten digits).');
  if (key === rec.apiKey) throw new Error('That is the key this world has now.');
  let meta: { id: string; name: string };
  try {
    meta = await new OwV2Client({ apiKey: key, apiPin: pin || undefined, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).getWorld();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'key_revoked') throw new Error('That key was revoked too. Make a new one on the world\'s page on onlyworlds.com.');
    if (code === 'invalid_credentials' && (e as { param?: string | null }).param !== 'API-Pin') throw new Error('OnlyWorlds does not know that key. Copy it again from the world\'s page on onlyworlds.com.');
    throw e;
  }
  if (meta.id !== rec.id) throw new Error(`That key is for another world, "${meta.name}". Copy the key from this world's page on onlyworlds.com.`);
  // Who the old key was (its Character, its role) is not who this key is; the copy itself stays.
  await db.updateWorldRecord(rec.id, { apiKey: key, keyKind: kind, characterId: undefined, memberRole: undefined, role: undefined });
  forgetSession(rec.id);
}

/**
 * A player's write key, minted for their first shared note (the Captain h37 #4420): a player's
 * phone reads with a read key until then, so it holds a write key only once they share. keel lets
 * a member mint one only with an account PIN set (409 pin_required).
 */
export async function mintPlayerKey(worldId: string, characterId: string): Promise<string> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in with the account you play with first: sharing a note goes from it.');
  const other = new Error("This phone is signed in to another account than the one you play this world with, so your note can't go from it. Sign in as yourself first.");
  // keel mints the signed-in account's own key: an owner's key on the game master's phone, another
  // player's on a friend's (the S406 gate, G1). Only a player's seat of this world is asked for.
  const listed = (await fetchAccountWorlds(token)).find((w) => w.id === worldId);
  if (!listed || listed.member_role !== 'guest') throw other;
  let key: string;
  try {
    key = (
      await accountClient(token).request<{ key: string }>('POST', `/account/worlds/${worldId}/keys`, {
        body: { scope: 'write', name: `Lantern on ${deviceName()}` },
      })
    ).key;
  } catch (e) {
    if ((e as { code?: string }).code === 'pin_required') throw new Error('Set a PIN on onlyworlds.com first: sharing a note needs one.');
    if ((e as { status?: number }).status === 404) throw other;
    throw e;
  }
  // Another player of the same world is a guest too: the new key must be this Character's seat.
  const me = await new OwV2Client({ apiKey: key, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).me();
  if (me.role !== 'guest' || me.character !== characterId) throw other;
  return key;
}

/** Open a world with a key someone gave you (and its PIN, checked once by a read that sends it). */
export async function openWithKey(apiKey: string, pin?: string): Promise<db.WorldRecord> {
  const key = apiKey.trim();
  const kind: OwKeyKind = detectKeyKind(key);
  if (kind === 'account') throw new Error('That is an account token: use Sign in instead.');
  if (kind === 'unknown') throw new Error('That does not look like a world key (ow_w_, ow_r_, or ten digits).');
  const c = new OwV2Client({ apiKey: key, apiPin: pin || undefined, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
  const meta = await c.getWorld();
  const existing = await db.getWorldRecord(meta.id);
  const sameKey = existing?.apiKey === key;
  await takeOver(existing, key);
  const rec: db.WorldRecord = {
    ...existing,
    // Who the old key was (its Character, its role) is not who this key is, and where its walk
    // stood is not where this key's starts.
    ...(sameKey
      ? {}
      : { characterId: undefined, memberRole: undefined, role: undefined, cursor: undefined, appliedHead: undefined, appliedEpoch: undefined, count: undefined, lastSync: undefined }),
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

/**
 * Keep a player seat's read key (Keel #353), straight from keel's join answer, with no further
 * call: the key is shown once and the code is spent, so it reaches the phone before anything that
 * could fail. The world then opens like one opened with a key, as a guest reading as its Character.
 */
export async function adoptPlayerSeat(world: { id: string; name: string }, key: string, characterId: string): Promise<db.WorldRecord> {
  const existing = await db.getWorldRecord(world.id);
  // Never in place of a copy that is someone's own (an account world, a key with changes not
  // sent): a game master trying their own player link keeps their world. The seat stays made on
  // keel and the owner removes it; a copy opened earlier with a key is replaced, as any key does.
  if (existing && existing.apiKey !== key && (existing.role || (await db.outboxRows(existing.id)).length)) {
    throw new Error(`${existing.name} is on this phone already as your own copy, so the player link did not replace it. The link is used now: remove the player it made from the world's members on onlyworlds.com.`);
  }
  await takeOver(existing, key);
  const rec: db.WorldRecord = {
    ...existing,
    id: world.id,
    name: world.name,
    kind: 'online',
    apiKey: key,
    keyKind: detectKeyKind(key),
    // An account role on this phone was the old holder's; this seat has none.
    role: undefined,
    memberRole: 'guest',
    characterId,
    playerSeat: true,
    cursor: undefined,
    appliedHead: undefined,
    appliedEpoch: undefined,
    count: undefined,
    lastSync: undefined,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  await db.putWorldRecord(rec);
  return rec;
}

export const DEMO_KEY = '0000000001';
