import { describe, it, expect } from 'vitest';
import { accessUrl, canInvite, SIGNUP_URL } from '../src/invite';

// S407: Invite someone opens the website's Access pane (keel makes invite links only there),
// offered only on a world the account list says you own.

describe('invite', () => {
  it('only an online world you own', () => {
    expect(canInvite({ kind: 'online', role: 'owner' })).toBe(true);
    expect(canInvite({ kind: 'online', role: 'collaborator' })).toBe(false);
    expect(canInvite({ kind: 'online' })).toBe(false); // opened with a key: no account role known
    expect(canInvite({ kind: 'local', role: 'owner' })).toBe(false);
  });
  it('the world page at Access, and the sign-up page, on the API host', () => {
    expect(accessUrl('0e1f')).toBe('https://www.onlyworlds.com/account/worlds/0e1f#access');
    expect(accessUrl('a/b')).toBe('https://www.onlyworlds.com/account/worlds/a%2Fb#access');
    expect(SIGNUP_URL).toBe('https://www.onlyworlds.com/accounts/signup/');
  });
});
