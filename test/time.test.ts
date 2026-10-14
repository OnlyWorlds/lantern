// Before now: a world's Events in order, split at the world's now (src/time.ts).
import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { clockFrom, dateText, hasDatedEvent, ongoing, spanText, timeline } from '../src/time';

const ev = (id: string, name: string, start?: number, end?: number) =>
  ({ id, type: 'event', name, start_date: start, end_date: end }) as unknown as OwElement;

describe('before now', () => {
  it("reads the clock as keel sends it, and as Atlas's folder writes it", () => {
    expect(clockFrom({ time_range_current: 453, time_basic_unit: 'Year' })).toEqual({ now: 453, unit: 'Year' });
    expect(clockFrom({ time_current: -12, time_basic_unit: '  ' })).toEqual({ now: -12, unit: undefined });
    expect(clockFrom({ time_range_current: null })).toEqual({ now: undefined, unit: undefined });
  });

  it('puts the Events in the order they happened, split at now; a tie by its end, then its name', () => {
    const els = [
      ev('5', 'The flood', 460),
      ev('1', 'The founding', 10),
      ev('3', 'The siege', 400, 410),
      ev('2', 'The quarrel', 400, 402),
      ev('4', 'The crowning', 453), // at now: it has happened
      ev('6', 'A rumour'),
      { id: '7', type: 'character', name: 'Ada', start_date: 1 } as unknown as OwElement,
    ];
    const t = timeline(els, 453);
    expect(t.before.map((e) => e.name)).toEqual(['The founding', 'The quarrel', 'The siege', 'The crowning']);
    expect(t.after.map((e) => e.name)).toEqual(['The flood']);
    expect(t.undated.map((e) => e.name)).toEqual(['A rumour']);
    // No now: every dated Event, in order, and nothing is after.
    expect(timeline(els).before).toHaveLength(5);
    expect(timeline(els).after).toEqual([]);
  });

  it('says a date with its unit, a span once, never backwards; knows what is still going', () => {
    expect(dateText(-30, 'Year')).toBe('Year -30');
    expect(dateText(7)).toBe('7');
    expect(spanText(ev('a', 'a', 400, 410), 'Year')).toBe('Year 400 to 410');
    expect(spanText(ev('a', 'a', 400, 390), 'Year')).toBe('Year 400');
    expect(spanText(ev('a', 'a', undefined, 390), 'Year')).toBe('until Year 390');
    expect(ongoing(ev('a', 'a', 440, 470), 453)).toBe(true);
    expect(ongoing(ev('a', 'a', 440, 450), 453)).toBe(false);
    expect(ongoing(ev('a', 'a', 440), 453)).toBe(false);
  });

  it('is offered only once an Event has a date (the Captain, h37 #4359)', () => {
    expect(hasDatedEvent([])).toBe(false);
    expect(hasDatedEvent([ev('6', 'A rumour'), { id: '7', type: 'character', name: 'Ada', start_date: 1 } as unknown as OwElement])).toBe(false);
    expect(hasDatedEvent([ev('6', 'A rumour'), ev('1', 'The founding', 0)])).toBe(true);
  });
});
