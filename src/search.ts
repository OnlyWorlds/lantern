// Find: names first (exact, then prefix, then a word's start, then anywhere), then the other
// words an element carries (supertype, subtype, description). Accents and case never matter.
import type { OwElement } from '@onlyworlds/sdk';

export function norm(s: unknown): string {
  return typeof s === 'string' ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';
}

export interface Hit {
  el: OwElement;
  rank: number;
  /** Where a non-name hit matched, for the row's hint. */
  where?: string;
}

export function search(elements: Iterable<OwElement>, query: string, limit = 40): Hit[] {
  const q = norm(query.trim());
  if (!q) return [];
  const hits: Hit[] = [];
  for (const el of elements) {
    const name = norm(el.name);
    let rank = -1;
    let where: string | undefined;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(' ' + q) || name.includes('-' + q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    else if (norm(el.supertype).includes(q) || norm(el.subtype).includes(q)) {
      rank = 4;
      where = 'kind';
    } else if (norm(el.description).includes(q)) {
      rank = 5;
      where = 'description';
    }
    if (rank >= 0) hits.push({ el, rank, where });
  }
  hits.sort((a, b) => a.rank - b.rank || (a.el.name || '').length - (b.el.name || '').length || (a.el.name || '').localeCompare(b.el.name || ''));
  return hits.slice(0, limit);
}
