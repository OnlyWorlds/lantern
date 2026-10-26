// Before now (the old Flutter app's timeline, reframed; Titus, 2026-10-13): a world's
// Events in the order they happened, with the world's now between what has happened and what has
// not. Pure: the screen is src/views/time.ts.
//
// The time line is keel's: a world's now is `time_range_current` (Atlas's folder writes it as
// `time_current`), its unit `time_basic_unit`, an Event's dates the integers `start_date` and
// `end_date`. Atlas can name those numbers with a calendar (`atlas_calendar`, SDK 4.20's copy of
// Atlas's kernel): a world with exactly one names its dates here as Atlas does on a device that
// never chose (which one a device chose is Atlas's own, not the world's); otherwise the numbers
// with the unit. A calendar never changes the order.
import { formatStep, resolveCalendarLens, type CalendarConfig, type OwElement } from '@onlyworlds/sdk';

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

/**
 * The world's calendar, as Atlas resolves it: the one chosen on this phone (`null`: the numbers),
 * else its only one; with several and no choice, none (nothing guessed).
 */
export function calendarOf(elements: Iterable<OwElement>, chosen?: string | null): CalendarConfig | null {
  return resolveCalendarLens(elements, chosen, { fallbackToOnly: true })?.config ?? null;
}

/** "3 Frost 412 AE" in the world's calendar; else "Year 412", or the bare number when the world names no unit. */
export function dateText(n: number, unit?: string, cal?: CalendarConfig | null): string {
  // A calendar that only gives the number back (no era reaches it, a bare one) says less than the unit does.
  const named = cal && Number.isInteger(n) ? formatStep(cal, n) : '';
  if (named && named !== String(n)) return named;
  return unit ? `${unit} ${n}` : String(n);
}

/** "Year 412", "Year 412 to 430" (an end before its start is left out, never shown backwards). */
export function spanText(el: OwElement, unit?: string, cal?: CalendarConfig | null): string {
  const start = num(el.start_date);
  const end = num(el.end_date);
  if (start === undefined) return end === undefined ? '' : `until ${dateText(end, unit, cal)}`;
  if (end === undefined || end <= start) return dateText(start, unit, cal);
  return `${dateText(start, unit, cal)} to ${cal ? dateText(end, unit, cal) : end}`;
}

/** A schema date field (`birth_date`, `start_date`, …): Atlas's rule, never a custom field. */
export function isDateField(field: string): boolean {
  return !/^(x|shadow|atlas)_/.test(field) && (field === 'date' || /^[a-z]+(?:_[a-z]+)*_date$/.test(field));
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

/**
 * Whether Before now has anything to put in order: an Event with a start date. Events with none
 * would make it a screen of the now line and nothing around it (Titus, 2026-10-14).
 */
export function hasDatedEvent(elements: Iterable<OwElement>): boolean {
  for (const e of elements) if (e.type === 'event' && num(e.start_date) !== undefined) return true;
  return false;
}

/** Under way at now: started, and its end (if it has one) not yet reached. */
export function ongoing(el: OwElement, now?: number): boolean {
  const start = num(el.start_date);
  const end = num(el.end_date);
  return now !== undefined && start !== undefined && start <= now && end !== undefined && end > now;
}
