// Take back an account token Lantern minted, when Lantern lets it go (S476, Atlas 1.93.0's twin;
// contract `Forge/Notes/2026-10-25-s476-lantern-token-revoke-contract.md`): `DELETE
// /account/tokens/{id}` by the id kept at the mint, with the token itself as the bearer (keel asks
// no PIN here). Never a lookup by last four or name: a delete runs only on an id Lantern made and
// kept.
//
// keel's answers (probed on a crew account in S475): 204 revoked; 401 the token works no more
// (revoked already); 404 the bearer works and the id is not its account's, so the token is still
// LIVE. Revoking a token minted by Sign in with OnlyWorlds ends the person's consent for Lantern
// only when it was Lantern's last live token for them.
//
// This never writes the app database: the caller has already let the token go, and a sign-in that
// lands meanwhile must not be undone by an old answer.
import { API_BASE } from './world';

/** How long a revoke may take: it is best effort, and nothing waits on it longer. */
export const TOKEN_REVOKE_LIMIT_MS = 8_000;

/** keel's token ids are UUIDs; anything else is never kept or sent. */
export function isTokenId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** What `kv` keeps beside `accountToken`: keel's id for the token, and the token's last eight characters. */
export interface TokenMint {
  id: string;
  tail: string;
}

export function mintOf(token: string, id: unknown): TokenMint | undefined {
  return token && isTokenId(id) ? { id, tail: token.slice(-8) } : undefined;
}

/** The id Lantern kept for this very token, or nothing: an id counts only beside the token it came with. */
export function mintedTokenId(token: string | undefined, mint: TokenMint | undefined): string | undefined {
  if (!token || !mint || !isTokenId(mint.id) || typeof mint.tail !== 'string' || mint.tail.length !== 8) return undefined;
  return token.endsWith(mint.tail) ? mint.id : undefined;
}

/** 'revoked': the token works no more. 'kept': it may still work (no answer, a refusal, or a 404). */
export type RevokeOutcome = 'revoked' | 'kept';

export async function revokeToken(
  token: string,
  tokenId: string,
  deps: { fetch?: typeof fetch; limitMs?: number } = {},
): Promise<RevokeOutcome> {
  if (!token || !isTokenId(tokenId)) return 'kept';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.limitMs ?? TOKEN_REVOKE_LIMIT_MS);
  const send = (keepalive: boolean) =>
    (deps.fetch ?? fetch)(`${API_BASE}/account/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      // A page closed right after Sign out still sends it.
      keepalive,
      signal: ctl.signal,
    });
  try {
    let res: Response;
    try {
      res = await send(true);
    } catch (err) {
      // A browser may refuse a keepalive request that needs a preflight: once more without it,
      // unless the time limit already ended it.
      if (ctl.signal.aborted) throw err;
      res = await send(false);
    }
    if (res.ok || res.status === 401) return 'revoked';
    if (res.status === 404) console.error('[token-revoke] keel does not know this id for this token: the token may still work');
    else console.warn(`[token-revoke] not revoked (${res.status})`);
    return 'kept';
  } catch (err) {
    console.warn('[token-revoke] not revoked (no answer):', err);
    return 'kept';
  } finally {
    clearTimeout(timer);
  }
}
