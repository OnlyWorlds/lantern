// A caught note made into an element: the first line its name, the rest its description.
import { describe, expect, it } from 'vitest';
import { elementFromNote, titleFrom, valuesFromNote } from '../src/note';

describe('elementFromNote', () => {
  it('one line is a name and nothing else', () => {
    expect(elementFromNote('  Mira Vell  ')).toEqual({ name: 'Mira Vell' });
  });

  it('the lines after the first are the description, the blank line between them dropped', () => {
    expect(elementFromNote('Mira Vell\n\nA smith in the lower town.\nOwes the guild.')).toEqual({
      name: 'Mira Vell',
      description: 'A smith in the lower town.\nOwes the guild.',
    });
  });

  it('a first line cut short keeps the whole note as the description, so no word is lost', () => {
    const long = 'The smith who keeps the forge by the river and never speaks of the war';
    const r = elementFromNote(long + '\nmore');
    expect([...r.name].length).toBeLessThanOrEqual(58);
    expect(r.name.endsWith('…')).toBe(true);
    expect(r.description).toBe(long + '\nmore');
  });

  it('a long first line is cut at a word, never inside one (Quillon, h37 #4275)', () => {
    const r = elementFromNote("Ines, the lighthouse keeper's daughter, who keeps the lamp lit when her father drinks");
    // "…keeps the lamp" runs to 58 characters, past the 57 kept, so "lamp" goes whole.
    expect(r.name).toBe("Ines, the lighthouse keeper's daughter, who keeps the…");
  });

  it('a first line that repeats later is cut at its first place', () => {
    expect(elementFromNote('Ash\nAsh')).toEqual({ name: 'Ash', description: 'Ash' });
  });
});

describe('valuesFromNote (making a note an element by hand)', () => {
  it('takes the whole note from its description, not its shortened name', () => {
    expect(valuesFromNote({ name: 'Old Marta…', description: 'Old Marta\nSells charms by the bridge.' })).toEqual({
      name: 'Old Marta',
      description: 'Sells charms by the bridge.',
    });
  });

  it('keeps a picture that is online or held on the phone, never one still waiting to send', () => {
    expect(valuesFromNote({ name: 'A page', image_url: 'https://media.onlyworlds.com/x.webp' }).image_url).toBe('https://media.onlyworlds.com/x.webp');
    expect(valuesFromNote({ name: 'A page', image_url: 'data:image/webp;base64,AAA' }).image_url).toBe('data:image/webp;base64,AAA');
    expect(valuesFromNote({ name: 'A page', image_url: 'blob:https://lantern/1' }).image_url).toBeUndefined();
  });
});

describe('titleFrom', () => {
  it('an empty note with a photo is a page of the day', () => {
    expect(titleFrom('', true, new Date('2026-10-12T09:00:00'))).toBe('A page, 12 October');
  });
});
