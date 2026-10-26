// Ask in a sentence: how each of keel's answers is said. What is sent is the SDK's
// buildAskContext (Kael's tests hold its limits); the walk checks it reaches the proxy.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const db = await import('../src/db');
const { askInASentence } = await import('../src/ask');


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

  it('no sign-in: nothing is sent', async () => {
    await db.kvSet('accountToken', undefined);
    reply = () => json(200, { answer: 'x' });
    await expect(askInASentence('w1', 'q', ['x'])).rejects.toThrow(/Sign in/);
    expect(sent).toBeNull();
  });
});
