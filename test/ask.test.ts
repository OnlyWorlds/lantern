// Ask in a sentence (Keel #159): what is sent (the lookup's elements as text, within keel's
// limits) and how each of keel's answers is said.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';

const db = await import('../src/db');
const { askInASentence, contextFor, elementText } = await import('../src/ask');

const el = (o: Partial<OwElement> & { id: string; type: string }) => o as OwElement;
const names: Record<string, string> = { l1: 'Balkonon', c2: 'Ada' };
const nameOf = (id: string) => names[id];

describe('what is sent', () => {
  it('an element as text: name and type, kind, description, filled fields, links by name', () => {
    const t = elementText(
      el({ id: 'c1', type: 'character', name: 'Mira Thel', supertype: 'Knight', description: 'Holds the fort.', location: 'l1', friends: ['c2', 'gone'] }),
      nameOf,
    );
    expect(t.split('\n')).toEqual(['Mira Thel (character)', 'kind: Knight', 'description: Holds the fort.', 'location: Balkonon', 'friends: Ada']);
  });

  it("keel's limits: at most 8 elements, 2,000 characters each, 12,000 in all", () => {
    const long = el({ id: 'x', type: 'narrative', name: 'Long', description: 'w'.repeat(5000) });
    expect([...elementText(long, nameOf)].length).toBe(2000);
    const many = Array.from({ length: 12 }, (_, i) => el({ id: `n${i}`, type: 'narrative', name: `N${i}`, description: 'w'.repeat(1900) }));
    const ctx = contextFor(many, nameOf);
    expect(ctx.length).toBeLessThanOrEqual(8);
    expect(ctx.join('').length).toBeLessThanOrEqual(12000);
    expect(ctx.length).toBe(6);
  });
});

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
