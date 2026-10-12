import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { canGive, narrativeFieldFor, partyChoices, partySize, revealValues } from '../src/party';

const el = (type: string, extra: Record<string, unknown> = {}): OwElement => ({ id: `${type}-1`, type, name: `A ${type}`, ...extra }) as OwElement;

describe('give it to the party', () => {
  it('links the thing in the Narrative field the schema gives its type', () => {
    expect(narrativeFieldFor('object')).toBe('objects');
    expect(narrativeFieldFor('location')).toBe('locations');
    expect(narrativeFieldFor('character')).toBe('characters');
  });

  it('is offered on things, never on a Collective (a Narrative\'s collectives are who knows it) or map furniture', () => {
    expect(canGive('object')).toBe(true);
    expect(canGive('creature')).toBe(true);
    for (const t of ['collective', 'narrative', 'pin', 'marker', 'zone']) expect(canGive(t)).toBe(false);
  });

  it('tells the party, carries its own picture and line, and links the thing', () => {
    const sword = el('object', { name: 'Vorpal Blade', image_url: 'https://media.onlyworlds.com/x.webp', description: 'Cursed. The DM only.' });
    const v = revealValues(sword, 'party-1', '  A rusted sword  ', ' It hums when you hold it. ');
    expect(v).toEqual({
      name: 'A rusted sword',
      description: 'It hums when you hold it.',
      image_url: 'https://media.onlyworlds.com/x.webp',
      collectives: ['party-1'],
      objects: ['object-1'],
    });
  });

  it('copies none of the thing\'s own words: only the name and line the game master gave', () => {
    const sword = el('object', { name: 'Vorpal Blade', description: 'Secret', story: 'Secret too', supertype: 'Artifact' });
    const v = revealValues(sword, 'p', 'A sword', '');
    expect(JSON.stringify(v)).not.toMatch(/Secret|Vorpal|Artifact/);
    expect(v.description).toBeUndefined();
    // An empty name falls back to a plain phrase, never the thing's own (the sheet asks for one).
    expect(revealValues(sword, 'p', '  ', '').name).toBe('Something found');
  });

  it('never puts a Character in the knowers: a revealed person is who it is about', () => {
    const v = revealValues(el('character'), 'party-1', 'A stranger', '');
    expect(v.characters).toEqual(['character-1']);
    expect(v.collectives).toEqual(['party-1']);
    expect(v.narrator).toBeUndefined();
  });

  it('a Collective handed to it anyway is never made a knower of the reveal', () => {
    expect(revealValues(el('collective'), 'party-1', 'x', '').collectives).toEqual(['party-1']);
  });

  it('copies only a picture a phone can show', () => {
    expect(revealValues(el('object', { image_url: 'javascript:alert(1)' }), 'p', 'x', '').image_url).toBeUndefined();
    expect(revealValues(el('object', { image_url: 'data:image/webp;base64,AA' }), 'p', 'x', '').image_url).toBe('data:image/webp;base64,AA');
  });

  it('lists the Collectives with supertype Party first, then by name', () => {
    const cs = [
      el('collective', { id: 'a', name: 'Zealots' }),
      el('character', { id: 'x', name: 'Not one' }),
      el('collective', { id: 'b', name: 'The Company', supertype: 'Party' }),
      el('collective', { id: 'c', name: 'artisans' }),
    ];
    expect(partyChoices(cs).map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('counts the Characters in the party', () => {
    expect(partySize(el('collective', { characters: ['a', 'b'] }))).toBe(2);
    expect(partySize(el('collective'))).toBe(0);
    expect(partySize(undefined)).toBe(0);
  });
});
