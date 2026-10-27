// The open door: a link `#/open/<world id>[/element/<id>]` read from the router's parts, what the door
// does for it (decided before anything is made), and how it waits through a sign-in beside an invite.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const db = await import('../src/db');
const door = await import('../src/opendoor');
const join = await import('../src/join');
type Deps = import('../src/opendoor').OpenDeps;
type AccountWorld = import('../src/account').AccountWorld;

const WORLD = '0aaa0000-0000-4000-8000-000000000001';
const EL = '0eee0000-0000-4000-8000-000000000001';
const parts = (hash: string) => hash.replace(/^#/, '').split('/').filter(Boolean);

describe('the link read from the address', () => {
  it('a world, and a world with an element', () => {
    expect(door.openWantOf(parts(`#/open/${WORLD}`))).toEqual({ world: WORLD });
    expect(door.openWantOf(parts(`#/open/${WORLD}/element/${EL}`))).toEqual({ world: WORLD, element: EL });
  });
  it('upper case ids read as keel writes them', () => {
    expect(door.openWantOf(parts(`#/open/${WORLD.toUpperCase()}/element/${EL.toUpperCase()}`))).toEqual({ world: WORLD, element: EL });
  });
  it('a world id that is not one is a link cut short, never a guess', () => {
    expect(door.openWantOf(parts('#/open/0aaa0000-0000-4000'))).toEqual({ world: '' });
    expect(door.openWantOf(parts('#/open/%E0%A4%A'))).toEqual({ world: '' });
  });
  it('an element id that is not one opens the world alone', () => {
    expect(door.openWantOf(parts(`#/open/${WORLD}/element/nope`))).toEqual({ world: WORLD });
    expect(door.openWantOf(parts(`#/open/${WORLD}/elements/${EL},${EL}`))).toEqual({ world: WORLD });
  });
  it('a bare #/open carries no link: it reads what waits', () => {
    expect(door.openWantOf(parts('#/open'))).toBeNull();
    expect(door.openWantOf(parts(`#/w/${WORLD}`))).toBeNull();
  });
  it('the page it lands on', () => {
    expect(door.hashFor({ world: WORLD })).toBe(`#/w/${WORLD}`);
    expect(door.hashFor({ world: WORLD, element: EL })).toBe(`#/w/${WORLD}/e/${EL}`);
  });
});

describe('a pasted OnlyWorlds address', () => {
  const SITE = 'https://www.onlyworlds.com/w/';
  it('the site link to a world, and to an element, asks for the same as the door', () => {
    expect(door.openWantOfAddress(`${SITE}${WORLD}`)).toEqual({ want: { world: WORLD } });
    expect(door.openWantOfAddress(`${SITE}${WORLD}/character/${EL}`)).toEqual({ want: { world: WORLD, element: EL } });
  });
  it('the ow:// text form with its world reads the same', () => {
    expect(door.openWantOfAddress(`ow://${WORLD}/location/${EL}`)).toEqual({ want: { world: WORLD, element: EL } });
    expect(door.openWantOfAddress(`ow://${WORLD}`)).toEqual({ want: { world: WORLD } });
  });
  it('found inside a message, without the punctuation after it', () => {
    expect(door.openWantOfAddress(`Look at her (${SITE}${WORLD}/character/${EL}).`)).toEqual({ want: { world: WORLD, element: EL } });
    expect(door.addressIn(`see ${SITE}${WORLD}, then`)).toBe(`${SITE}${WORLD}`);
  });
  it('a moment and a lens are set aside: the element opens', () => {
    expect(door.openWantOfAddress(`${SITE}${WORLD}/character/${EL}@12?lens=${EL}`)).toEqual({ want: { world: WORLD, element: EL } });
  });
  it('hex in capitals reads lower case, as keel writes it', () => {
    expect(door.openWantOfAddress(`${SITE}${WORLD.toUpperCase()}/character/${EL.toUpperCase()}`)).toEqual({ want: { world: WORLD, element: EL } });
  });
  it('a world named by its page name is refused in words, never guessed', () => {
    expect(door.openWantOfAddress(`${SITE}hyperion/character/${EL}`)).toEqual({ refused: door.ADDRESS_SLUG_LINE });
  });
  it('an element with no world is refused: the text form inside a world', () => {
    expect(door.openWantOfAddress(`ow://character/${EL}`)).toEqual({ refused: door.ADDRESS_NO_WORLD_LINE });
  });
  it('a link cut short, an unknown type or a type in capitals is refused, never opened as the world', () => {
    for (const s of [`${SITE}${WORLD}/character`, `${SITE}${WORLD}/`, `${SITE}${WORLD}/hero/${EL}`, `${SITE}${WORLD}/Character/${EL}`, `${SITE}${WORLD.slice(0, 20)}`, `HTTPS://WWW.ONLYWORLDS.COM/w/${WORLD}`]) {
      expect(door.openWantOfAddress(s), s).toEqual({ refused: door.ADDRESS_BROKEN_LINE });
    }
  });
  it('text with no address is not one: an invite, another site, plain words', () => {
    for (const s of ['https://www.onlyworlds.com/join#ow_j_abc', `https://example.com/w/${WORLD}`, 'a note about Ada', '']) {
      expect(door.openWantOfAddress(s), s).toBeNull();
    }
  });
});

describe('what the door does', () => {
  const row: AccountWorld = { id: WORLD, name: 'Puddleton', role: 'owner' };
  let asked: number;
  const deps = (o: Partial<Deps> = {}): Deps => ({
    onPhone: async () => false,
    token: async () => 'ow_a_token',
    online: () => true,
    accountWorlds: async () => {
      asked++;
      return [row];
    },
    accountName: async () => 'mara',
    ...o,
  });
  beforeEach(() => {
    asked = 0;
  });

  it('nothing waiting: nothing to do', async () => {
    expect(await door.decideOpen(undefined, deps())).toEqual({ kind: 'none' });
  });
  it('a link cut short says so, and asks keel nothing', async () => {
    expect(await door.decideOpen({ world: '' }, deps())).toEqual({ kind: 'malformed' });
    expect(asked).toBe(0);
  });
  it('a world on the phone opens at once, at the element, signed in or not, with or without signal', async () => {
    const d = deps({ onPhone: async (id) => id === WORLD, token: async () => undefined, online: () => false });
    expect(await door.decideOpen({ world: WORLD, element: EL }, d)).toEqual({ kind: 'here', hash: `#/w/${WORLD}/e/${EL}` });
    expect(asked).toBe(0);
  });
  it('signed out: sign in first, and keel is not asked', async () => {
    expect(await door.decideOpen({ world: WORLD }, deps({ token: async () => undefined }))).toEqual({ kind: 'signin' });
    expect(asked).toBe(0);
  });
  it('signed in without signal: says it needs a connection', async () => {
    expect(await door.decideOpen({ world: WORLD }, deps({ online: () => false }))).toEqual({ kind: 'offline' });
  });
  it('the account world is asked about, never opened by the link alone', async () => {
    expect(await door.decideOpen({ world: WORLD }, deps())).toEqual({ kind: 'ask', world: row });
    expect(asked).toBe(1);
  });
  it('a world the account does not hold names the account', async () => {
    const other = '0aaa0000-0000-4000-8000-000000000002';
    expect(await door.decideOpen({ world: other }, deps())).toEqual({ kind: 'not-yours', who: 'mara' });
  });
  it('a list keel could not give is said, not read as not yours', async () => {
    const error = new Error('No connection.');
    const step = await door.decideOpen({ world: WORLD }, deps({ accountWorlds: async () => { throw error; } }));
    expect(step).toEqual({ kind: 'unread', error, signIn: false });
  });
  it('a sign-in keel no longer takes asks for a sign-in, not another try', async () => {
    const error = Object.assign(new Error('Invalid token.'), { status: 401 });
    const step = await door.decideOpen({ world: WORLD }, deps({ accountWorlds: async () => { throw error; } }));
    expect(step).toEqual({ kind: 'unread', error, signIn: true });
  });
  it('a list that never comes is said after its time limit', async () => {
    const step = await door.decideOpen({ world: WORLD }, deps({ accountWorlds: () => new Promise(() => {}), listMs: 20 }));
    expect(step.kind).toBe('unread');
  });
});

describe('the link waits through a sign-in', () => {
  beforeEach(async () => {
    await db.kvSet('pendingJoin', undefined);
    await db.kvSet('pendingOpen', undefined);
  });

  it('nothing waiting lands on Your worlds', async () => {
    expect(await door.afterSignInHash()).toBe('#/worlds');
  });
  it('a world link waiting lands on the door', async () => {
    await door.setPendingOpen({ world: WORLD, element: EL }, 1000);
    expect(await door.pendingOpen(1000)).toEqual({ world: WORLD, element: EL, at: 1000 });
    expect(await door.afterSignInHash()).toBe('#/worlds'); // the clock now is long after 1000
    await door.setPendingOpen({ world: WORLD });
    expect(await door.afterSignInHash()).toBe('#/open');
  });
  it('a link left waiting lapses: a sign-in an hour on lands on Your worlds', async () => {
    await door.setPendingOpen({ world: WORLD }, 0);
    expect(await door.pendingOpen(door.OPEN_WAIT_MS - 1)).toBeDefined();
    expect(await door.pendingOpen(door.OPEN_WAIT_MS)).toBeUndefined();
  });
  it('the screen drops only the link it read: a newer one stays', async () => {
    await door.setPendingOpen({ world: WORLD }, 1);
    const read = await door.pendingOpen(1);
    await door.setPendingOpen({ world: WORLD, element: EL }, 2);
    await door.clearPendingOpen(read);
    expect(await door.pendingOpen(2)).toEqual({ world: WORLD, element: EL, at: 2 });
    await door.clearPendingOpen(await door.pendingOpen(2));
    expect(await door.pendingOpen(2)).toBeUndefined();
  });
  it('the newest link wins: a world link that waits for a sign-in after an invite', async () => {
    await join.setPendingJoin('ow_j_good');
    await door.setPendingOpen({ world: WORLD });
    expect(await join.pendingJoin()).toBe('ow_j_good'); // read alone, the world link drops nothing
    await door.holdThroughSignIn();
    expect(await join.pendingJoin()).toBeUndefined();
    expect(await door.afterSignInHash()).toBe('#/open');
  });
  it('the newest link wins: an invite after a world link', async () => {
    await door.setPendingOpen({ world: WORLD });
    await join.setPendingJoin('ow_j_good');
    expect(await door.pendingOpen()).toBeUndefined();
    expect(await door.afterSignInHash()).toBe('#/join');
  });
  it('clearing the world link leaves an invite as it was', async () => {
    await join.setPendingJoin('ow_j_good');
    await door.setPendingOpen(undefined);
    expect(await join.pendingJoin()).toBe('ow_j_good');
  });
});
