// Before now: a world's Events in order, split at the world's now (src/time.ts).
import { describe, expect, it } from 'vitest';
import { formatStep, type OwElement } from '@onlyworlds/sdk';
import { calendarOf, clockFrom, dateText, hasDatedEvent, isDateField, ongoing, spanText, timeline } from '../src/time';

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

describe("the world's calendar (SDK 4.20, Atlas's kernel)", () => {
  const cfg = { version: 1, grain: 'Year', eras: [{ name: 'After the Eruption', abbrev: 'AE', start: 0 }] };
  const calendar = (id: string, value: unknown) => ({ id, type: 'construct', name: id, supertype: 'calendar', atlas_calendar: value }) as unknown as OwElement;

  it('names dates only when the world holds exactly one calendar, as Atlas does on a device that never chose', () => {
    expect(calendarOf([ev('1', 'x', 3), calendar('c1', cfg)])).toEqual(cfg);
    // Moppetopia, the Captain's own world, holds two: numbers, nothing guessed.
    expect(calendarOf([calendar('c1', cfg), calendar('c2', { version: 1, grain: 'Year' })])).toBeNull();
    expect(calendarOf([ev('1', 'x', 3)])).toBeNull();
    // A JSON string is read as Atlas's object (another tool may serialize it); a broken one is no calendar.
    expect(calendarOf([calendar('c1', JSON.stringify(cfg))])).toEqual(cfg);
    expect(calendarOf([calendar('c1', { grain: 7 })])).toBeNull();
  });

  it("follows this phone's choice: a calendar by id, null for the numbers, a removed one as never chosen", () => {
    const two = [calendar('c1', cfg), calendar('c2', { version: 1, grain: 'Year', step_name: 'Turn' })];
    expect(calendarOf(two, 'c1')).toEqual(cfg);
    expect(calendarOf([calendar('c1', cfg)], null)).toBeNull();
    // A dangling choice (the calendar deleted in Atlas) resolves to nothing, as Atlas's lens does.
    expect(calendarOf(two, 'gone')).toBeNull();
  });

  it("speaks the calendar's words, and the numbers without one", () => {
    const cal = calendarOf([calendar('c1', cfg)])!;
    expect(dateText(412, 'Year', cal)).toBe(formatStep(cal, 412));
    expect(dateText(412, 'Year', cal)).toMatch(/AE/);
    expect(dateText(412, 'Year', null)).toBe('Year 412');
    // Where the calendar only gives the number back (before every era, a bare calendar), the unit says more.
    expect(dateText(-3, 'Year', cal)).toBe('Year -3');
    expect(dateText(412, 'Year', { version: 1, grain: 'Year' })).toBe('Year 412');
    expect(spanText(ev('1', 'War', 10, 20), 'Year', cal)).toBe(`${formatStep(cal, 10)} to ${formatStep(cal, 20)}`);
    expect(spanText(ev('1', 'War', 10, 20), 'Year')).toBe('Year 10 to 20');
  });

  it('reads a version 2 calendar: a leap rule with exceptions, every 4 years but not every 100, yet every 400 (SDK 4.76)', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const greg = {
      version: 2, grain: 'day',
      bundles: { months: { names: months, lengths: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] } },
      intercalary: [{ name: 'Leap day', after_month: 2, every_years: 4, except: [100, 400], offset: 1 }],
      eras: [{ name: 'Common Era', abbrev: 'CE', start: 0 }],
    };
    const cal = calendarOf([calendar('g', greg)]);
    expect(cal).not.toBeNull();
    // The step after 28 Feb, counted by the proleptic Gregorian rule written out here, not the SDK's.
    const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const mar1 = (year: number) => { let d = 0; for (let y = 1; y < year; y++) d += leap(y) ? 366 : 365; return d + 31 + 28; };
    expect(dateText(mar1(1900), 'Day', cal)).toBe('1 Mar, 1900 CE');
    expect(dateText(mar1(2000), 'Day', cal)).toBe('Leap day, 2000 CE');
    expect(dateText(mar1(2000) + 1, 'Day', cal)).toBe('1 Mar, 2000 CE');
  });

  it('an open era runs to the next up era, a down era listed after it skipped (SDK 4.76)', () => {
    const eras = { version: 1, grain: 'Year', eras: [{ name: 'After', abbrev: 'AF', start: 0 }, { name: 'Before', abbrev: 'BF', start: 0, direction: 'down' }] };
    expect(dateText(5, 'Year', calendarOf([calendar('e', eras)]))).toContain('6 AF');
  });

  it("knows a schema date field by Atlas's rule, never a custom one", () => {
    for (const f of ['date', 'start_date', 'end_date', 'birth_date', 'formation_date']) expect(isDateField(f)).toBe(true);
    for (const f of ['x_wedding_date', 'shadow_birth_date', 'atlas_calendar', 'update', 'dates']) expect(isDateField(f)).toBe(false);
  });
});
