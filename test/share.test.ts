import { describe, expect, it } from 'vitest';
import { composeShared } from '../src/share';

describe('a share from another app', () => {
  it('title, text and link, each once, in that order', () => {
    expect(composeShared({ title: 'Rope', text: 'Buy rope at the docks', url: 'https://example.com/rope' })).toBe(
      'Rope\nBuy rope at the docks\nhttps://example.com/rope',
    );
  });

  it('a link already inside the text is not added again; nor a title the text repeats', () => {
    expect(composeShared({ title: 'Rope', text: 'Rope: https://example.com/rope', url: 'https://example.com/rope' })).toBe('Rope: https://example.com/rope');
  });

  it('a short title the text only contains somewhere stays (the gate: "Map" vanished)', () => {
    expect(composeShared({ title: 'Map', text: 'The map of the docks' })).toBe('Map\nThe map of the docks');
    expect(composeShared({ title: 'rope', text: 'Rope: buy it' })).toBe('Rope: buy it');
  });

  it('empty and missing parts drop out', () => {
    expect(composeShared({ title: '  ', text: null, url: 'https://example.com' })).toBe('https://example.com');
    expect(composeShared({})).toBe('');
  });
});
