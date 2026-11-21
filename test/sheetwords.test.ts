// What the sheets say after a save, a delete, a PIN or a file tap, in each state.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { OwApiError } from '@onlyworlds/sdk';

const { REPLACED_REFUSAL, deletedText, fileLinkError, pinSheetError, savedText } = await import('../src/sheetwords');
const { WaitSaid, waitClock } = await import('../src/sendwait');

const wait = { until: new Date(2026, 10, 21, 4, 52, 30).getTime(), code: 'rate_limited' };
const at = waitClock(wait);
const base = { local: false, online: true, wait: null, pinKnown: true };

describe('savedText', () => {
  it('an edit: sending, offline, the wait with and without a PIN, quiet on a world on this phone only', () => {
    expect(savedText('Saved.', base, false, true)).toBe('Saved. Sending…');
    expect(savedText('Saved.', { ...base, online: false }, false, true)).toBe('Saved on this phone. It sends when you have signal.');
    expect(savedText('Saved.', { ...base, wait }, false, true)).toBe(`Saved. It waits on this phone and goes by itself at ${at}.`);
    expect(savedText('Saved.', { ...base, wait, pinKnown: false }, false, true)).toBe(`Saved. It waits on this phone; enter your PIN after ${at}.`);
    expect(savedText('Saved.', { ...base, local: true }, false, true)).toBeNull();
  });

  it('says when it took the place of a refused change', () => {
    expect(savedText('Saved.', base, true, true)).toBe(`Saved. Sending… ${REPLACED_REFUSAL}`);
    expect(savedText('Picture saved.', { ...base, wait }, true)).toBe(`Picture saved. It waits on this phone and goes by itself at ${at}. ${REPLACED_REFUSAL}`);
  });

  it('a picture: its own words, offline, and on a world on this phone only', () => {
    expect(savedText('Picture saved.', base, false)).toBe('Picture saved. Sending…');
    expect(savedText('Picture removed.', { ...base, online: false }, false)).toBe('Picture removed. It sends when you have signal.');
    expect(savedText('Picture saved.', { ...base, local: true }, false)).toBe('Picture saved.');
  });
});

describe('deletedText', () => {
  it('said only when it was done or is on its way', () => {
    expect(deletedText('The seal', false, base)).toBeNull();
    expect(deletedText('The seal', true, base)).toBe('Deleted The seal.');
    expect(deletedText('The seal', true, { ...base, local: true, online: false })).toBe('Deleted The seal.');
    expect(deletedText('The seal', true, { ...base, online: false })).toBe('Deleted The seal on this phone. It sends when you have signal.');
  });

  it("during keel's wait: when it goes, or when to enter the PIN if none is kept", () => {
    expect(deletedText('The seal', true, { ...base, wait })).toBe(`Deleted The seal on this phone. It waits on this phone and goes by itself at ${at}.`);
    expect(deletedText('The seal', true, { ...base, wait, pinKnown: false })).toBe(`Deleted The seal on this phone. It waits on this phone; enter your PIN after ${at}.`);
  });
});

describe('pinSheetError', () => {
  it("keel's wait in its own words, though they name PINs; a refused PIN as the PIN; anything else as itself", () => {
    const said = 'OnlyWorlds is holding off after too many wrong PINs. Try again after 4:53 AM.';
    expect(pinSheetError(new WaitSaid(said), said)).toBe(said);
    expect(pinSheetError(new Error('x'), 'Invalid credentials (401)')).toBe('That PIN does not open this world.');
    expect(pinSheetError(new Error('x'), 'No connection')).toBe('No connection');
  });
});

describe('fileLinkError', () => {
  it("keel's wait, a file gone, or a try again", () => {
    expect(fileLinkError(new WaitSaid('OnlyWorlds is holding off. Try again after 4:53 AM.'))).toBe('OnlyWorlds is holding off. Try again after 4:53 AM.');
    expect(fileLinkError(new OwApiError(404, 'not_found', 'Not found.', null, null))).toBe('This file is no longer on OnlyWorlds.');
    expect(fileLinkError(new Error('boom'))).toBe('The file could not be fetched. Try again in a moment.');
  });
});
