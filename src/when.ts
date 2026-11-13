/**
 * Times in order as instants, never as text: the SDK's `instantOf` reads a served time by the message
 * profile's grammar (an offset, `Z`, or none read as UTC), and `compareInstants` orders them. Text
 * comparison put `…12.5Z` after `…12Z` and a `+02:00` time by its digits, not its moment.
 *
 * Both orders put a time that cannot be read after every readable one, and give 0 for two equal
 * instants, so `sort` (stable) keeps the order the list was given: the message profile's ties.
 */

import { compareInstants, instantOf } from '@onlyworlds/sdk';

/** Earlier first. */
export function earlierFirst(a: unknown, b: unknown): number {
  return compareInstants(instantOf(a), instantOf(b));
}

/** Newest first; a time that cannot be read still last. */
export function newestFirst(a: unknown, b: unknown): number {
  const x = instantOf(a), y = instantOf(b);
  return x === null || y === null ? compareInstants(x, y) : compareInstants(y, x);
}
