// A caught note made into an element: the first line its name, the rest its description.
import { describe, expect, it } from 'vitest';
import { elementFromNote, titleFrom } from '../src/note';

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

  it('a first line that repeats later is cut at its first place', () => {
    expect(elementFromNote('Ash\nAsh')).toEqual({ name: 'Ash', description: 'Ash' });
  });
});

describe('titleFrom', () => {
  it('an empty note with a photo is a page of the day', () => {
    expect(titleFrom('', true, new Date('2026-10-12T09:00:00'))).toBe('A page, 12 October');
  });
});
