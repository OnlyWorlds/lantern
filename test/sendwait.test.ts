// keel's wait (429): how long, which answers start it, where it is kept, and that it is kept.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

const { fetchThatHolds, forgetAccountWait, holdSends, homeWaitLine, HELD_HOME_TEXT, HELD_TEXT, pinAfterText, waitWhy, readWait, waitClock, waitingLine, waitScope, waitSeconds, waitText, MAX_WAIT_S } = await import('../src/sendwait');
const db = await import('../src/db');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: string, headers: Record<string, string> = {}): typeof fetch {
  return (async () => new Response(body, { status, headers })) as typeof fetch;
}

let n = 0;
/** A world of its own, with its own PIN (opened with a key): its own two places. */
const world = () => waitScope({ id: `sw-${++n}` });

describe('waitSeconds', () => {
  it("takes keel's seconds whole, up to its 901, a minute when none is said", () => {
    expect(MAX_WAIT_S).toBe(901);
    expect(waitSeconds(900)).toBe(900);
    expect(waitSeconds(901)).toBe(901);
    expect(waitSeconds(301)).toBe(301);
    expect(waitSeconds(86_400)).toBe(901);
    expect(waitSeconds(0)).toBe(1);
    expect(waitSeconds(null)).toBe(60);
    expect(waitSeconds(undefined)).toBe(60);
  });
});

describe('holdSends and readWait', () => {
  it('keeps the longer of two waits, and lets an ended one go', async () => {
    const scope = world();
    const now = 1_000_000;
    await holdSends(scope, { code: 'rate_limited', retryAfter: 900 }, now);
    const shorter = await holdSends(scope, { code: 'rate_limited', retryAfter: 10 }, now);
    expect(shorter).toEqual({ until: now + 900_000, code: 'rate_limited' });
    expect(await readWait(scope, now + 899_000)).not.toBeNull();
    expect(await readWait(scope, now + 900_000)).toBeNull();
    expect(await readWait(scope, now)).toBeNull(); // let go once read as ended
  });

  it('the wrong-PIN lock is the PIN holder\'s: every world of the account waits, a world with its own PIN does not', async () => {
    const now = 2_000_000;
    const a = waitScope({ id: 'acct-a', role: 'owner' });
    const b = waitScope({ id: 'acct-b', role: 'collaborator' });
    const own = waitScope({ id: 'own-c' });
    await holdSends(a, { code: 'rate_limited', retryAfter: 600 }, now);
    expect((await readWait(b, now))?.until).toBe(now + 600_000);
    expect(await readWait(own, now)).toBeNull();
  });

  it("a busy key's wait (any other 429) is its world's alone", async () => {
    const now = 3_000_000;
    const a = waitScope({ id: 'busy-a', role: 'owner' });
    const b = waitScope({ id: 'busy-b', role: 'owner' });
    await holdSends(a, { code: 'too_many_requests', retryAfter: 30 }, now);
    expect((await readWait(a, now))?.code).toBe('too_many_requests');
    expect(await readWait(b, now)).toBeNull();
    // Both places at once: the later one holds.
    await holdSends(a, { code: 'rate_limited', retryAfter: 120 }, now);
    expect((await readWait(a, now))?.until).toBe(now + 120_000);
  });

  it('a kept end further off than keel ever asks (a clock set back), or not a number, reads as ended', async () => {
    const now = 4_000_000;
    for (const until of [now + 3 * 3600_000, now + 902_000, Number.NaN, Infinity]) {
      const scope = world();
      await db.kvSet(`sendWait:${scope.world}`, { until });
      expect(await readWait(scope, now)).toBeNull();
      expect(await db.kvGet(`sendWait:${scope.world}`)).toBeUndefined();
    }
    const scope = world();
    await db.kvSet(`sendWait:${scope.world}`, { until: now + 901_000 });
    expect(await readWait(scope, now)).not.toBeNull();
  });
});

describe('waitClock', () => {
  it('rounds the minute up, never early', () => {
    const at = new Date(2026, 10, 21, 4, 52, 30).getTime();
    const shown = waitClock({ until: at });
    const expected = new Date(2026, 10, 21, 4, 53, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(shown).toBe(expected);
    const exact = new Date(2026, 10, 21, 4, 52, 0).getTime();
    expect(waitClock({ until: exact })).toBe(new Date(exact).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  });
});

describe('fetchThatHolds', () => {
  it("a wrong-PIN 429 starts the PIN holder's wait with keel's Retry-After", async () => {
    const scope = world();
    globalThis.fetch = answer(429, JSON.stringify({ error: { code: 'rate_limited', message: 'Too many failed PIN attempts. Try again later.' } }), { 'Retry-After': '900' });
    const t0 = Date.now();
    const res = await fetchThatHolds(scope)('https://x.test/api/v2/bulk');
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited'); // the caller still reads the answer
    const w = await readWait(scope);
    expect(w?.code).toBe('rate_limited');
    expect(await db.kvGet(`sendWait:${scope.pin}`)).toBeTruthy();
    expect(w!.until - t0).toBeGreaterThanOrEqual(899_000);
    expect(waitText(w!)).toMatch(/^OnlyWorlds is holding off after too many wrong PINs\. Your changes wait on this phone and go by themselves at \S/);
  });

  it("a day's allowance (a picture's quota, an AI use) is said where it was met: never a wait for sends", async () => {
    for (const code of ['quota_exceeded', 'use_ceiling', 'use_in_flight']) {
      const scope = world();
      globalThis.fetch = answer(429, JSON.stringify({ error: { code } }), { 'Retry-After': '40000' });
      await fetchThatHolds(scope)('https://x.test/api/v2/media/ticket');
      expect(await readWait(scope)).toBeNull();
    }
  });

  it('a 429 with no envelope and no Retry-After waits a minute; any other answer starts nothing', async () => {
    const scope = world();
    globalThis.fetch = answer(429, 'slow down');
    const t0 = Date.now();
    await fetchThatHolds(scope)('https://x.test/api/v2/world');
    const w = await readWait(scope);
    expect(w!.until - t0).toBeGreaterThanOrEqual(59_000);
    expect(w!.until - t0).toBeLessThanOrEqual(61_000);
    expect(waitText(w!)).toMatch(/^OnlyWorlds asked this phone to wait before sending more\./);

    const other = world();
    globalThis.fetch = answer(503, '{}', { 'Retry-After': '5' });
    await fetchThatHolds(other)('https://x.test/api/v2/world');
    expect(await readWait(other)).toBeNull();
  });
});

describe('the words for the waiting changes', () => {
  const wait = { until: new Date(2026, 10, 21, 4, 52, 30).getTime(), code: 'rate_limited' };
  const base = { waiting: 2, held: 0, wait: null, pinKnown: true, askPin: false };

  it('Waiting to send: by themselves, the PIN first, the wait, the wait with no PIN, and the held', () => {
    expect(waitingLine({ ...base, waiting: 0 })).toBe('');
    expect(waitingLine(base)).toBe('They send by themselves whenever the phone has signal.');
    expect(waitingLine({ ...base, pinKnown: false, askPin: true })).toBe('They send as soon as the PIN is in.');
    expect(waitingLine({ ...base, wait })).toBe(waitText(wait));
    expect(waitingLine({ ...base, wait, pinKnown: false, askPin: true })).toBe(pinAfterText(wait));
    expect(pinAfterText(wait)).toMatch(/^OnlyWorlds is holding off after too many wrong PINs\. Enter your PIN after \S.*; your changes wait on this phone\.$/);
    // Held behind a change OnlyWorlds did not take: never "by themselves" over it.
    expect(waitingLine({ ...base, held: 2 })).toBe(HELD_TEXT);
    expect(waitingLine({ ...base, held: 2, wait })).toBe(HELD_TEXT);
    expect(waitingLine({ ...base, held: 1 })).toBe(`They send by themselves whenever the phone has signal. ${HELD_TEXT}`);
  });

  it('the home: the wait, the wait with no PIN, and nothing when every waiting change is held or none runs', () => {
    expect(homeWaitLine(base)).toBeNull();
    expect(homeWaitLine({ ...base, wait })).toBe(waitText(wait));
    expect(homeWaitLine({ ...base, wait, pinKnown: false })).toBe(pinAfterText(wait));
    // Every waiting change held: the wait is said, and never a PIN question.
    expect(homeWaitLine({ ...base, wait, held: 2 })).toBe(`${waitWhy(wait)} ${HELD_HOME_TEXT}`);
    expect(homeWaitLine({ ...base, wait, held: 2, pinKnown: false, askPin: true })).toBe(`${waitWhy(wait)} ${HELD_HOME_TEXT}`);
    expect(homeWaitLine({ ...base, wait, waiting: 0 })).toBeNull();
  });
});

describe('forgetAccountWait', () => {
  it("lets the account's wrong-PIN wait go, and a world's own waits stay", async () => {
    const now = Date.now();
    const acct = waitScope({ id: 'fa', role: 'owner' });
    const own = waitScope({ id: 'fb' });
    await holdSends(acct, { code: 'rate_limited', retryAfter: 600 }, now);
    await holdSends(own, { code: 'rate_limited', retryAfter: 600 }, now);
    // A busy key's wait is its world's, an account world's included: not the account's to let go.
    const busy = waitScope({ id: 'fc', role: 'owner' });
    await holdSends(busy, { code: 'too_many_requests', retryAfter: 30 }, now);
    await forgetAccountWait();
    expect(await readWait(acct, now)).toBeNull();
    expect(await readWait(own, now)).not.toBeNull();
    expect((await readWait(busy, now))?.code).toBe('too_many_requests');
  });
});
