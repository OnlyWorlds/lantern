// Ask in a sentence: how each of keel's answers is said. What is sent is the SDK's
// buildAskContext (Kael's tests hold its limits); the walk checks it reaches the proxy.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const db = await import('../src/db');
const { askInASentence, AskRefused } = await import('../src/ask');
const { sortNotes, SortRefused } = await import('../src/sort');
const { paidLine, OWN_KEY_REFUSED } = await import('../src/own-key');


describe("keel's answers", () => {
  let reply: () => Response;
  let sent: { auth: string | null; body: { world_id: string; question: string; context: string[] } } | null;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  beforeEach(async () => {
    sent = null;
    await db.kvSet('accountToken', 'ow_a_test');
    globalThis.fetch = (async (_u: RequestInfo | URL, init: RequestInit = {}) => {
      sent = { auth: new Headers(init.headers).get('Authorization'), body: JSON.parse(String(init.body)) };
      return reply();
    }) as typeof fetch;
  });

  it('an answer, with the questions left today; the world and the context go as given', async () => {
    reply = () => json(200, { answer: 'Mira Thel holds Balkonon.', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 90, output_tokens: 9 }, remaining: 49 });
    const a = await askInASentence('w1', 'Who holds Balkonon?', ['Mira Thel (character)']);
    expect(a).toEqual({ answer: 'Mira Thel holds Balkonon.', remaining: 49, none: false });
    expect(sent).toEqual({ auth: 'Bearer ow_a_test', body: { world_id: 'w1', question: 'Who holds Balkonon?', context: ['Mira Thel (character)'] } });
  });

  it('"The world doesn\'t say." is the none answer', async () => {
    reply = () => json(200, { answer: "The world doesn't say.", remaining: 48 });
    expect((await askInASentence('w1', 'Who?', ['x'])).none).toBe(true);
  });

  it('the allowance, a pause, a failed model: each its own sentence', async () => {
    reply = () => json(429, { error: { code: 'quota_exceeded' } });
    await expect(askInASentence('w1', 'q', ['x'])).rejects.toThrow(/used up/);
    reply = () => json(503, { error: { code: 'ask_unavailable' } });
    await expect(askInASentence('w1', 'q', ['x'])).rejects.toThrow(/paused/);
    reply = () => json(502, { error: { code: 'ask_failed' } });
    await expect(askInASentence('w1', 'q', ['x'])).rejects.toThrow(/No answer came back/);
  });

  // The account's own AI key (keel 441): keel's answer says who paid; a refused key is a 422 of its own.
  const refusedKey = () => json(422, { error: { type: 'invalid_request', code: 'own_key_refused', message: 'Your AI key was refused by its provider; check it on your account page.' } });

  it('an answer on the own key carries who paid, and its line gives no count', async () => {
    reply = () => json(200, { answer: 'Mira Thel holds Balkonon.', remaining: 0, paid_by: 'own_key' });
    const a = await askInASentence('w1', 'Who holds Balkonon?', ['x']);
    expect(a.paidBy).toBe('own_key');
    expect(paidLine(a.paidBy, a.remaining)).toBe(' Answered on your own AI key.');
    expect(paidLine('rating', 49)).toBe(' 49 left today.');
    expect(paidLine(undefined, 48, 'AI answers', 'Sorted')).toBe(' 48 AI answers left today.');
    expect(paidLine('own_key', 0, 'AI answers', 'Sorted')).toBe(' Sorted on your own AI key.');
  });

  it('Ask: a refused own key is its own sentence, marked for the key page', async () => {
    reply = refusedKey;
    const e = await askInASentence('w1', 'q', ['x']).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AskRefused);
    expect((e as InstanceType<typeof AskRefused>).ownKey).toBe(true);
    expect((e as Error).message).toBe(OWN_KEY_REFUSED);
  });

  it('the sort: a refused own key carries no status, so the photo fallback (422, 502) never sends again', async () => {
    reply = refusedKey;
    const e = await sortNotes('w1', [{ text: 'a note', image_url: 'https://media.onlyworlds.com/u/w1/a.webp' }], []).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SortRefused);
    expect((e as InstanceType<typeof SortRefused>).ownKey).toBe(true);
    expect((e as InstanceType<typeof SortRefused>).status).toBeUndefined();
    reply = () => json(200, { rows: [], not_proposed: [], remaining: 0, paid_by: 'own_key' });
    expect((await sortNotes('w1', ['a note'], [])).paidBy).toBe('own_key');
  });

  it('no sign-in: nothing is sent', async () => {
    await db.kvSet('accountToken', undefined);
    reply = () => json(200, { answer: 'x' });
    await expect(askInASentence('w1', 'q', ['x'])).rejects.toThrow(/Sign in/);
    expect(sent).toBeNull();
  });
});
