// The PIN: one for every world of your account, its own for a world opened with a key; kept on the
// phone; the account's cleared on sign-out (the Captain, h37 #3675; Skeld #3674).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});
const { pinFor, setPin, forgetAccountPin } = await import('../src/pin');

beforeEach(() => store.clear());

describe('the PIN', () => {
  it('one for every world of your account, its own for a world opened with a key', () => {
    setPin({ id: 'a', role: 'owner' }, '1234');
    expect(pinFor({ id: 'b', role: 'collaborator' })).toBe('1234');
    expect(pinFor({ id: 'k' })).toBeUndefined();
    setPin({ id: 'k' }, '5678');
    expect(pinFor({ id: 'k' })).toBe('5678');
    expect(pinFor({ id: 'a', role: 'owner' })).toBe('1234');
  });

  it("is kept on the phone (localStorage), and sign-out clears the account's, not a key world's", () => {
    setPin({ id: 'a', role: 'owner' }, '1234');
    setPin({ id: 'k' }, '5678');
    expect([...store.values()].sort()).toEqual(['1234', '5678']);
    forgetAccountPin();
    expect(pinFor({ id: 'a', role: 'owner' })).toBeUndefined();
    expect(pinFor({ id: 'k' })).toBe('5678');
  });

  it("signing out takes the account's PIN with it", async () => {
    const { signOut } = await import('../src/account');
    setPin({ id: 'a', role: 'owner' }, '1234');
    await signOut();
    expect(pinFor({ id: 'a', role: 'owner' })).toBeUndefined();
  });
});
