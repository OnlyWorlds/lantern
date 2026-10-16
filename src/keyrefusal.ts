/**
 * Why keel refused a world's key (Atlas #198's twin, S418): the cause keel named, so the phone
 * never asks for a PIN when the key is what died. keel since #357 (Skeld h16 #6018): a revoked key
 * is 401 `key_revoked`; a key it does not know (a removed member's, a deleted world's) is 401
 * `invalid_credentials` with no param; a wrong or missing PIN is the same code with param
 * `API-Pin`. A read key on a write is 403 `permission_error`.
 */

export type KeyRefusal = 'key_revoked' | 'key_unknown' | 'pin' | 'read_only_key';

export function keyRefusalOf(e: unknown): KeyRefusal | null {
  const x = e as { status?: unknown; code?: unknown; param?: unknown } | null;
  if (!x || typeof x.status !== 'number' || typeof x.code !== 'string') return null;
  if (x.code === 'key_revoked') return 'key_revoked';
  if (x.code === 'permission_error') return 'read_only_key';
  if (x.code === 'invalid_credentials') return x.param === 'API-Pin' ? 'pin' : 'key_unknown';
  return null;
}

/** A new key cures it: the key died, or it only reads. A refused PIN is not the key's. */
export function newKeyCures(r: KeyRefusal | null | undefined): boolean {
  return r === 'key_revoked' || r === 'key_unknown' || r === 'read_only_key';
}

/** The home's line for a refused key: the cause, never "check your PIN" for a key that died. */
export function keyRefusalText(r: KeyRefusal | null | undefined): string {
  switch (r) {
    case 'key_revoked': return "This world's key was revoked on onlyworlds.com. Changes wait here.";
    case 'key_unknown': return "OnlyWorlds no longer knows this world's key: the world was deleted there, or you were removed from it. Changes wait here.";
    case 'read_only_key': return "This world's key only reads, so changes can't be sent. They wait here.";
    case 'pin': return 'OnlyWorlds did not accept your PIN.';
    default: return 'This key no longer opens the world';
  }
}
