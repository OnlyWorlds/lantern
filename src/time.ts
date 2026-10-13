// Before now (the old Flutter app's timeline, reframed; the Captain h37 #4061, #4072): a world's
// Events in the order they happened, with the world's now between what has happened and what has
// not. Pure: the screen is src/views/time.ts.
//
// The time line is keel's: a world's now is `time_range_current` (Atlas's folder writes it as
// `time_current`), its unit `time_basic_unit`, an Event's dates the integers `start_date` and
// `end_date`. Atlas can name those numbers with a calendar (`atlas_calendar`); Lantern shows the
// numbers with the unit, which a calendar never changes the order of.
import type { OwElement } from '@onlyworlds/sdk';

export interface WorldClock {
  now?: number;
  unit?: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The clock from keel's world record, or a world file's world.json. */
export function clockFrom(world: Record<string, unknown>): WorldClock {
  const unit = typeof world.time_basic_unit === 'string' && world.time_basic_unit.trim() ? world.time_basic_unit.trim() : undefined;
  return { now: num(world.time_range_current) ?? num(world.time_current), unit };
}

/** "Year 412", or the bare number when the world names no unit. */
export function dateText(n: number, unit?: string): string {
  return unit ? `${unit} ${n}` : String(n);
}

/** "Year 412", "Year 412 to 430" (an end before its start is left out, never shown backwards). */
export function spanText(el: OwElement, unit?: string): string {
  const start = num(el.start_date);
  const end = num(el.end_date);
  if (start === undefined) return end === undefined ? '' : `until ${dateText(end, unit)}`;
  return end !== undefined && end > start ? `${dateText(start, unit)} to ${end}` : dateText(start, unit);
}

export interface Timeline {
  /** Started at or before now (every dated Event, when the world has no now). */
  before: OwElement[];
  /** Starts after now. */
  after: OwElement[];
  /** No start date: kept reachable, never guessed into place. */
  undated: OwElement[];
}

export function timeline(elements: Iterable<OwElement>, now?: number): Timeline {
  const events = [...elements].filter((e) => e.type === 'event');
  const dated = events
    .filter((e) => num(e.start_date) !== undefined)
    .sort(
      (a, b) =>
        (a.start_date as number) - (b.start_date as number) ||
        (num(a.end_date) ?? (a.start_date as number)) - (num(b.end_date) ?? (b.start_date as number)) ||
        (a.name || '').localeCompare(b.name || '') ||
        (a.id < b.id ? -1 : 1),
    );
  const undated = events.filter((e) => num(e.start_date) === undefined).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (now === undefined) return { before: dated, after: [], undated };
  return {
    before: dated.filter((e) => (e.start_date as number) <= now),
    after: dated.filter((e) => (e.start_date as number) > now),
    undated,
  };
}

/** Under way at now: started, and its end (if it has one) not yet reached. */
export function ongoing(el: OwElement, now?: number): boolean {
  const start = num(el.start_date);
  const end = num(el.end_date);
  return now !== undefined && start !== undefined && start <= now && end !== undefined && end > now;
}
