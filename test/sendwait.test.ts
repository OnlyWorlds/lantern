// keel's wait (429) for a world: how long, which answers start it, and that it is kept.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

const { fetchThatHolds, holdSends, readWait, waitSeconds, waitText, MAX_WAIT_S } = await import('../src/sendwait');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: string, headers: Record<string, string> = {}): typeof fetch {
  return (async () => new Response(body, { status, headers })) as typeof fetch;
}

let n = 0;
const world = () => `sw-${++n}`;

describe('waitSeconds', () => {
  it("takes keel's seconds whole, up to its 900, a minute when none is said", () => {
    expect(MAX_WAIT_S).toBe(900);
    expect(waitSeconds(900)).toBe(900);
    expect(waitSeconds(301)).toBe(301);
    expect(waitSeconds(86_400)).toBe(900);
    expect(waitSeconds(0)).toBe(1);
    expect(waitSeconds(null)).toBe(60);
    expect(waitSeconds(undefined)).toBe(60);
  });
});

describe('holdSends', () => {
  it('keeps the longer of two waits, and lets an ended one go', async () => {
    const id = world();
    const now = 1_000_000;
    await holdSends(id, { code: 'rate_limited', retryAfter: 900 }, now);
    const shorter = await holdSends(id, { code: 'too_many_requests', retryAfter: 10 }, now);
    expect(shorter).toEqual({ until: now + 900_000, code: 'rate_limited' });
    expect(await readWait(id, now + 899_000)).not.toBeNull();
    expect(await readWait(id, now + 900_000)).toBeNull();
    expect(await readWait(id, now)).toBeNull(); // let go once read as ended
  });
});

describe('fetchThatHolds', () => {
  it("a 429 that is the world's starts the wait with keel's Retry-After", async () => {
    const id = world();
    globalThis.fetch = answer(429, JSON.stringify({ error: { code: 'rate_limited', message: 'Too many failed PIN attempts. Try again later.' } }), { 'Retry-After': '900' });
    const t0 = Date.now();
    const res = await fetchThatHolds(id)('https://x.test/api/v2/bulk');
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited'); // the caller still reads the answer
    const w = await readWait(id);
    expect(w?.code).toBe('rate_limited');
    expect(w!.until - t0).toBeGreaterThanOrEqual(899_000);
    expect(waitText(w!)).toMatch(/^OnlyWorlds is holding off after too many wrong PINs\. Your changes wait on this phone and go by themselves at \S/);
  });

  it("a day's allowance (a picture's quota, an AI use) is said where it was met: never the world's wait", async () => {
    for (const code of ['quota_exceeded', 'use_ceiling', 'use_in_flight']) {
      const id = world();
      globalThis.fetch = answer(429, JSON.stringify({ error: { code } }), { 'Retry-After': '40000' });
      await fetchThatHolds(id)('https://x.test/api/v2/media/ticket');
      expect(await readWait(id)).toBeNull();
    }
  });

  it('a 429 with no envelope and no Retry-After waits a minute; any other answer starts nothing', async () => {
    const id = world();
    globalThis.fetch = answer(429, 'slow down');
    const t0 = Date.now();
    await fetchThatHolds(id)('https://x.test/api/v2/world');
    const w = await readWait(id);
    expect(w!.until - t0).toBeGreaterThanOrEqual(59_000);
    expect(w!.until - t0).toBeLessThanOrEqual(61_000);
    expect(waitText(w!)).toMatch(/^OnlyWorlds asked this phone to wait before sending more\./);

    const other = world();
    globalThis.fetch = answer(503, '{}', { 'Retry-After': '5' });
    await fetchThatHolds(other)('https://x.test/api/v2/world');
    expect(await readWait(other)).toBeNull();
  });
});
