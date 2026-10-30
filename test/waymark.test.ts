// The OnlyWorlds mark beside a name (src/waymark-for.ts, #755; Atlas 1.112.0's twin): whether it
// shows, for whom, and what the component is given, on every way a world reaches the phone.
import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import type { WorldRecord } from '../src/db';
import { publicPageOnFrom, publicPageStale, readerOf, waymarkFor, PUBLIC_PAGE_FRESH_MS } from '../src/waymark-for';

const W = '0199c3a1-7b2e-7c3d-8e4f-5a6b7c8d9e01';
const E = '0199c3a1-7b2e-7c3d-8e4f-5a6b7c8d9e02';
const MARK = '0199c3a1-7b2e-7c3d-8e4f-5a6b7c8d9e0f';
const WRITE = 'ow_w_' + 'w'.repeat(30);
const READ = 'ow_r_' + 'r'.repeat(30);

const rec = (over: Partial<WorldRecord> = {}): WorldRecord =>
  ({ id: W, name: 'Moppetopia', kind: 'online', apiKey: WRITE, role: 'owner', ...over }) as WorldRecord;
const ch = (over: Record<string, unknown> = {}): OwElement =>
  ({ id: E, type: 'character', name: 'Ada', updated_at: '2026-10-30T10:00:00Z', changed_client: 'atlas', ...over }) as unknown as OwElement;

const lent = (over: Partial<WorldRecord> = {}): WorldRecord => rec({ role: undefined, ...over });

describe('who reads the world on onlyworlds.com', () => {
  it('a member by the account: the owner and every member role', () => {
    expect(readerOf(rec({ role: 'owner', apiKey: READ }))).toBe('member');
    for (const memberRole of ['co_builder', 'contributor', 'guest'] as const) {
      expect(readerOf(rec({ role: 'collaborator', memberRole, apiKey: READ }))).toBe('member');
    }
  });

  it('a key alone never makes a member: the site goes by its own sign-in, which Lantern cannot see', () => {
    // A write or ten-digit key someone lent, with no role or with keel's /me role on the key.
    expect(readerOf(lent())).toBe('public');
    expect(readerOf(lent({ apiKey: '1234567890' }))).toBe('public');
    expect(readerOf(lent({ memberRole: 'contributor' }))).toBe('public');
    // A role held aside while another account is signed in, on a write key and a read key.
    expect(readerOf(lent({ heldBy: 'someone', heldRole: 'owner' }))).toBe('public');
    expect(readerOf(lent({ apiKey: READ, heldBy: 'someone', heldRole: 'collaborator' }))).toBe('public');
  });

  it("the public face: a read key, a player's link", () => {
    expect(readerOf(lent({ apiKey: READ }))).toBe('public');
    expect(readerOf(lent({ apiKey: READ, playerSeat: true, memberRole: 'guest' }))).toBe('public');
  });

  it('a lent write key shows the mark only while the public page is on', () => {
    expect(waymarkFor(lent(), null)).toBeNull();
    expect(waymarkFor(lent({ publicPageOn: true }), null)?.reader).toBe('public');
  });
});

describe("the world's own mark", () => {
  it('a member sees it whatever the public page says', () => {
    for (const publicPageOn of [true, false, undefined]) {
      const p = waymarkFor(rec({ role: 'owner', publicPageOn }), null);
      expect(p).toEqual({ world: { id: W, name: 'Moppetopia' }, element: null, reader: 'member' });
    }
  });

  it('the public face only while the last answer said on', () => {
    expect(waymarkFor(lent({ apiKey: READ, publicPageOn: true }), null)?.reader).toBe('public');
    expect(waymarkFor(lent({ apiKey: READ, publicPageOn: false }), null)).toBeNull();
    expect(waymarkFor(lent({ apiKey: READ }), null)).toBeNull();
  });

  it('never a world on this phone only, the demo, or a world with no key', () => {
    expect(waymarkFor(rec({ kind: 'local', apiKey: undefined }), null)).toBeNull();
    expect(waymarkFor(rec({ kind: 'demo', apiKey: '0000000001' }), null)).toBeNull();
    expect(waymarkFor(rec({ apiKey: '0000000001' }), null)).toBeNull();
    expect(waymarkFor(rec({ apiKey: undefined }), null)).toBeNull();
    expect(waymarkFor(null, null)).toBeNull();
  });

  it("the world's own words go with it, and an unnamed world has a name", () => {
    const names = { character: { one: 'Moppet', many: 'Moppets' } };
    expect(waymarkFor(rec({ names }), null)?.world).toEqual({ id: W, name: 'Moppetopia', x_names: names });
    expect(waymarkFor(rec({ names: 'odd' }), null)?.world).toEqual({ id: W, name: 'Moppetopia' });
    expect(waymarkFor(rec({ name: '' }), null)?.world.name).toBe('Unnamed world');
  });
});

describe("an element's mark", () => {
  const owner = rec({ role: 'owner' });

  it("a member's carries keel's body (its doors) and a name", () => {
    const p = waymarkFor(owner, ch());
    expect(p?.reader).toBe('member');
    expect(p?.element).toMatchObject({ id: E, type: 'character', name: 'Ada', changed_client: 'atlas' });
    expect(waymarkFor(owner, ch({ name: '' }))?.element?.name).toBe('(unnamed)');
  });

  it('none while its create waits: keel does not hold it yet', () => {
    expect(waymarkFor(owner, ch(), { creating: true })).toBeNull();
  });

  it('a stub passes its id, type and name only', () => {
    expect(waymarkFor(owner, ch({ known_of: true }), { stub: true })?.element).toEqual({ id: E, type: 'character', name: 'Ada' });
  });

  it("while a change of mine waits: no door, since keel's last write is not what the page shows", () => {
    expect(waymarkFor(owner, ch(), { editing: true })?.element).toEqual({ id: E, type: 'character', name: 'Ada' });
  });

  it('the public face: only what the public page shows, and only its id, type and name', () => {
    const pub = lent({ apiKey: READ, publicPageOn: true });
    expect(waymarkFor(pub, ch())?.element).toEqual({ id: E, type: 'character', name: 'Ada' });
    expect(waymarkFor(pub, ch({ hidden: true }))).toBeNull();
    expect(waymarkFor(pub, ch({ x_review_proposed: 'yes' }))).toBeNull();
    expect(waymarkFor(pub, ch({ type: 'narrative', supertype: 'Message', x_room_of: MARK }))).toBeNull();
    expect(waymarkFor(pub, ch({ type: 'pin' }))).toBeNull();
    expect(waymarkFor(pub, ch({ type: 'marker' }))).toBeNull();
    expect(waymarkFor(lent({ apiKey: READ, publicPageOn: false }), ch())).toBeNull();
  });

  it('a member keeps the mark on a hidden, proposed or room element: their page shows it', () => {
    expect(waymarkFor(rec(), ch({ hidden: true }))?.reader).toBe('member');
    expect(waymarkFor(rec(), ch({ x_review_proposed: 'yes' }))?.reader).toBe('member');
    expect(waymarkFor(rec(), ch({ type: 'pin' }))?.reader).toBe('member');
  });
});

describe('the public page switch', () => {
  it("on exactly when public_read and public_page.on are both true (Skeld's rule)", () => {
    expect(publicPageOnFrom({ public_read: true, public_page: { on: true } })).toBe(true);
    expect(publicPageOnFrom({ public_read: true, public_page: { on: false } })).toBe(false);
    expect(publicPageOnFrom({ public_read: false, public_page: { on: true } })).toBe(false);
    expect(publicPageOnFrom({ public_read: true })).toBe(false);
    expect(publicPageOnFrom({ public_page: { on: true } })).toBe(false);
    expect(publicPageOnFrom({ public_read: true, public_page: null })).toBe(false);
    expect(publicPageOnFrom({ public_read: 'true', public_page: { on: 'true' } })).toBe(false);
  });

  it('stale when never answered or older than five minutes', () => {
    const now = 1_000_000_000;
    expect(publicPageStale(rec(), now)).toBe(true);
    expect(publicPageStale(rec({ publicPageAt: now - PUBLIC_PAGE_FRESH_MS }), now)).toBe(false);
    expect(publicPageStale(rec({ publicPageAt: now - PUBLIC_PAGE_FRESH_MS - 1 }), now)).toBe(true);
  });
});
