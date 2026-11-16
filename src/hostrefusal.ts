import { OwApiError } from '@onlyworlds/sdk';

/**
 * The web host in front of OnlyWorlds refuses some writes before keel sees them: a 403 whose body is
 * the host's own page, not keel's JSON envelope (text holding a shell command right after a code
 * mark, a semicolon or a pipe). keel answers every error with a code, so a 403 with none is the
 * host's: never the key, the PIN or the account, and only that one write is refused.
 *
 * Two tiers (Atlas's twin): `isHostRefusal` decides what the phone does; `isHostBlocked`, the host's
 * page titled "Blocked" as the SDK reads it, decides only whether the words may name the usual cause.
 */
export function isHostRefusal(e: unknown): boolean {
  return e instanceof OwApiError && e.status === 403 && (e.code === null || e.code === undefined);
}

export function isHostBlocked(e: unknown): boolean {
  return isHostRefusal(e) && (e as OwApiError).isHostBlocked === true;
}

/** The host's refusal of `what` ("this change", "these notes": `plural`), then `kept`: what is kept and where. */
export function hostRefusalText(e: unknown, what: string, kept: string, plural = false): string {
  const head = `The web host in front of OnlyWorlds refused ${what} before ${plural ? 'they' : 'it'} reached OnlyWorlds.`;
  const cause = isHostBlocked(e)
    ? ' A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, or in a code block that names its language.'
    : '';
  return `${head}${cause} ${kept}`;
}
