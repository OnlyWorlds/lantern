// A key mint whose answer was lost, against a fake keel that keeps keel's rules for world keys (keel PR
// 478, read line by line): a mint is never replayed (a second mint is a second key), the row keeps only
// a hash of the Idempotency-Key it was minted under, GET .../keys/made?key= answers the first row made
// under it without its secret (a revoked one too, `revoked` true) or one 404, and DELETE revokes a key
// of the world's by its id (again: 204). A keel before PR 478 answers the lookup 405: its path is the
// revoke's (read on production 2026-11-08).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

Object.assign(globalThis, { window: globalThis });

const db = await import('../src/db');
const { mintKey, pendingMints, sweepLostMints, SWEEP_AFTER_MS, FORGET_AFTER_MS, MINT_LIMIT_MS } = await import('../src/mints');

const TOKEN = 'ow_a_me';
const ACCOUNT = 'acct-me';
const WORLD = 'w-1';

interface Row { id: string; madeBy: string | null; live: boolean }

class FakeKeel {
  rows: Row[] = [];
  calls: string[] = [];
  /** The next mint commits and its answer is lost on the way back. */
  loseMintAnswer = false;
  /** The next mint is refused before anything is made (a member with no PIN). */
  refuseMint = false;
  /** keel cannot be reached at all. */
  offline = false;
  /** keel before PR 478: the lookup's path is the revoke's, so a GET there is 405. */
  madeRoute = true;
  /** Every mint's request carried a signal (its time limit). */
  mintSignals: boolean[] = [];
  n = 0;
  deletes = 0;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    this.calls.push(`${method} ${url.pathname}${url.search}`);
    if (this.offline) throw new TypeError('Failed to fetch');
    if (!headers.get('Authorization')?.startsWith(`Bearer ${TOKEN}`)) return json(401, { error: { code: 'invalid_credentials' } });
    const path = url.pathname.replace(/^\/api\/v2/, '');
    if (method === 'POST' && path === `/account/worlds/${WORLD}/keys`) {
      this.mintSignals.push(init?.signal instanceof AbortSignal);
      if (this.refuseMint) {
        this.refuseMint = false;
        return json(409, { error: { code: 'pin_required', message: 'Set a PIN first.' } });
      }
      const key = headers.get('Idempotency-Key');
      const row: Row = { id: `k${++this.n}`, madeBy: key && this.madeRoute ? `h:${key}` : null, live: true };
      this.rows.push(row);
      if (this.loseMintAnswer) {
        this.loseMintAnswer = false;
        throw new TypeError('Failed to fetch');
      }
      return json(201, { id: row.id, name: 'Lantern on a phone', last4: 'abcd', scope: 'write', revoked: false, kept: true, key: `ow_w_secret${row.id}` });
    }
    if (method === 'GET' && path === `/account/worlds/${WORLD}/keys/made`) {
      if (!this.madeRoute) return json(405, { detail: 'Method not allowed' });
      const key = url.searchParams.get('key');
      const row = this.rows.find((r) => key && r.madeBy === `h:${key}`);
      if (!row) return json(404, { error: { code: 'not_found', message: 'No key of this world\'s was minted by this account under that key.' } });
      return json(200, { id: row.id, name: 'Lantern on a phone', last4: 'abcd', scope: 'write', revoked: !row.live, kept: true });
    }
    const del = path.match(new RegExp(`^/account/worlds/${WORLD}/keys/([^/]+)$`));
    if (method === 'DELETE' && del) {
      const row = this.rows.find((r) => r.id === del[1]);
      if (!row) return json(404, { error: { code: 'not_found' } });
      this.deletes++;
      row.live = false;
      return new Response(null, { status: 204 });
    }
    return json(404, { error: { code: 'not_found' } });
  };

  live(): string[] {
    return this.rows.filter((r) => r.live).map((r) => r.id);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let keel: FakeKeel;
const later = () => Date.now() + SWEEP_AFTER_MS + 1000;

beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  for (const a of await pendingMints()) await db.kvSet(`pendingMint:${a.key}`, undefined);
  await db.kvSet('accountToken', TOKEN);
  await db.kvSet('accountId', ACCOUNT);
  for (const w of await db.listWorlds()) await db.removeWorld(w.id);
});

const body = { scope: 'write', name: 'Lantern on a phone', keep: true };

/** keel answers the mint and loses the answer; then the phone is offline for every later request. */
function loseMintThenOffline(): void {
  keel.loseMintAnswer = true;
  const realFetch = keel.fetch;
  let mintSeen = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (mintSeen) throw new TypeError('Failed to fetch');
    if ((init?.method ?? 'GET') === 'POST') mintSeen = true;
    return realFetch(input, init);
  }) as typeof fetch;
}

describe('a key mint', () => {
  it('goes under an Idempotency-Key and a time limit, and leaves no ask once its answer is in', async () => {
    const k = await mintKey<{ key: string; id?: string }>(TOKEN, WORLD, body);
    expect(k.id).toBe('k1');
    expect(keel.live()).toEqual(['k1']);
    expect(keel.rows[0].madeBy).toMatch(/^h:/);
    expect(keel.mintSignals).toEqual([true]);
    expect(MINT_LIMIT_MS).toBeLessThan(SWEEP_AFTER_MS);
    expect(await pendingMints()).toEqual([]);
    expect(keel.calls.filter((c) => c.includes('/made'))).toEqual([]);
  });

  it('whose answer is lost takes back the key that call made, by the id keel names', async () => {
    keel.loseMintAnswer = true;
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow();
    expect(keel.rows).toHaveLength(1);
    expect(keel.live()).toEqual([]);
    expect(await pendingMints()).toEqual([]);
  });

  it('whose answer is lost, retried, leaves the account one key', async () => {
    keel.loseMintAnswer = true;
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow();
    const k = await mintKey<{ key: string; id?: string }>(TOKEN, WORLD, body);
    expect(keel.live()).toEqual([k.id]);
  });

  it('refused (4xx) made nothing: no lookup, no ask left', async () => {
    keel.refuseMint = true;
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toMatchObject({ status: 409 });
    expect(keel.calls.filter((c) => c.includes('/made'))).toEqual([]);
    expect(await pendingMints()).toEqual([]);
  });

  it('failed with none made yet keeps its ask for one more look, which drops it', async () => {
    // A mint that never reached keel: "none made" right after may also be a mint keel is still writing.
    let first = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first && (init?.method ?? 'GET') === 'POST') { first = false; throw new TypeError('Failed to fetch'); }
      return keel.fetch(input, init);
    }) as typeof fetch;
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow();
    expect(await pendingMints()).toHaveLength(1);
    await sweepLostMints(Date.now()); // a moment later: keel may still be writing it, so kept
    expect(await pendingMints()).toHaveLength(1);
    await sweepLostMints(later()); // two minutes on, none made is believed
    expect(await pendingMints()).toEqual([]);
    expect(keel.live()).toEqual([]);
  });

  it('whose answer lands after a minute by the clock (a frozen page) is read as lost and taken back', async () => {
    const realNow = Date.now;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await keel.fetch(input, init);
      if ((init?.method ?? 'GET') === 'POST') Date.now = () => realNow() + MINT_LIMIT_MS + 1000; // the page thawed
      return res;
    }) as typeof fetch;
    try {
      await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow(/took too long/);
    } finally {
      Date.now = realNow;
    }
    expect(keel.live()).toEqual([]);
    expect(await pendingMints()).toEqual([]);
  });

  it('another sign-in\'s none made keeps the ask (keel answers each account its own keys)', async () => {
    let first = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first && (init?.method ?? 'GET') === 'POST') { first = false; throw new TypeError('Failed to fetch'); }
      return keel.fetch(input, init);
    }) as typeof fetch;
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow();
    await db.kvSet('accountToken', `${TOKEN}_other`); // the token changed before the id did
    await sweepLostMints(later());
    expect(await pendingMints()).toHaveLength(1);
  });

  it('whose answer and lookup are both lost keeps its ask; this tab settles it once back, at any age', async () => {
    loseMintThenOffline();
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow();
    expect(keel.live()).toEqual(['k1']);
    expect(await pendingMints()).toHaveLength(1);
    globalThis.fetch = keel.fetch as typeof fetch;
    await sweepLostMints(Date.now());
    expect(keel.live()).toEqual([]);
    expect(await pendingMints()).toEqual([]);
  });

  it('two at once, both lost with their lookups, keep both asks (one row each)', async () => {
    loseMintThenOffline();
    const realFetch = keel.fetch;
    let posts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST' || ++posts > 2) throw new TypeError('Failed to fetch');
      keel.loseMintAnswer = true;
      return realFetch(input, init);
    }) as typeof fetch;
    await Promise.allSettled([mintKey(TOKEN, WORLD, body), mintKey(TOKEN, WORLD, body)]);
    expect(keel.live()).toHaveLength(2);
    expect(await pendingMints()).toHaveLength(2);
    globalThis.fetch = keel.fetch as typeof fetch;
    await sweepLostMints(later());
    expect(keel.live()).toEqual([]);
    expect(await pendingMints()).toEqual([]);
  });

  it('on a keel before the lookup (405) is no worse than before, and leaves no ask behind', async () => {
    keel.madeRoute = false;
    keel.loseMintAnswer = true;
    await expect(mintKey(TOKEN, WORLD, body)).rejects.toThrow();
    await sweepLostMints(later());
    expect(await pendingMints()).toEqual([]);
    expect(keel.deletes).toBe(0);
  });
});

describe('the sweep', () => {
  async function cutOff(account = ACCOUNT, at = new Date().toISOString()): Promise<void> {
    // A reload cut the mint off: keel made the key, the phone kept only the ask.
    await db.kvSet('pendingMint:k-ask-1', { worldId: WORLD, key: 'k-ask-1', account, at });
    keel.rows.push({ id: 'k9', madeBy: 'h:k-ask-1', live: true });
  }

  it('takes back a cut-off mint\'s key two minutes on', async () => {
    await cutOff();
    await sweepLostMints(later());
    expect(keel.live()).toEqual([]);
    expect(await pendingMints()).toEqual([]);
  });

  it('leaves another tab\'s younger ask alone (that tab may be storing its answer)', async () => {
    await cutOff();
    await sweepLostMints(Date.now());
    expect(keel.live()).toEqual(['k9']);
    expect(await pendingMints()).toHaveLength(1);
    expect(keel.calls).toEqual([]);
  });

  it('never takes back a key a world on the phone holds', async () => {
    await cutOff();
    await db.putWorldRecord({ id: WORLD, name: 'W', kind: 'online', apiKey: 'ow_w_x', keyMint: { id: 'k9', tail: 'x' }, addedAt: new Date().toISOString() } as never);
    await sweepLostMints(later());
    expect(keel.live()).toEqual(['k9']);
    expect(keel.deletes).toBe(0);
    expect(await pendingMints()).toEqual([]);
  });

  it('keeps another account\'s ask a week without asking keel, then drops it', async () => {
    await cutOff('acct-someone-else');
    await sweepLostMints(later());
    expect(await pendingMints()).toHaveLength(1);
    await sweepLostMints(Date.now() + FORGET_AFTER_MS + 1000);
    expect(await pendingMints()).toEqual([]);
    expect(keel.calls).toEqual([]);
    expect(keel.live()).toEqual(['k9']);
  });

  it('asks again after a sign-out and back in as the same account', async () => {
    await cutOff();
    await db.kvSet('accountToken', `${TOKEN}_again`); // a new sign-in of the same account: the account id is the same
    await sweepLostMints(later());
    expect(keel.live()).toEqual([]);
  });

  it('settles a key already taken back without sending a revoke again', async () => {
    await cutOff();
    keel.rows[0].live = false; // revoked by hand on the account page since
    await sweepLostMints(later());
    expect(keel.deletes).toBe(0);
    expect(await pendingMints()).toEqual([]);
  });

  it('offline keeps the ask for the next time', async () => {
    await cutOff();
    keel.offline = true;
    await sweepLostMints(later());
    expect(await pendingMints()).toHaveLength(1);
  });

  it('drops any ask past a week, the signed-in account\'s too, and one with no readable date', async () => {
    await cutOff();
    keel.offline = true;
    await sweepLostMints(Date.now() + FORGET_AFTER_MS + 1000);
    expect(await pendingMints()).toEqual([]);
    await db.kvSet('pendingMint:k-bad', { worldId: WORLD, key: 'k-bad', account: ACCOUNT, at: 'not a date' });
    await sweepLostMints(later());
    expect(await pendingMints()).toEqual([]);
  });
});
