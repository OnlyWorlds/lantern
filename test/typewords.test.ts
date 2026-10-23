// A world's own words for the types (the names profile, schema-dist dist.48 `profiles/names.md`):
// the profile's 23 cases through typeName, and a world with no map printing what Lantern printed before.
import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES, getElementLabel } from '@onlyworlds/sdk';
import fixture from './fixtures/names.fixture.json';
import { aTypeName, setTypeWordsSource, supertypeWord, typeCount, typeLabel, typeName, typePlural } from '../src/schema';

const standard = (type: string, many: boolean): string =>
  many ? (ELEMENT_TYPES.includes(type as never) ? getElementLabel(type as never) : type).toLowerCase() : type.toLowerCase();

describe("the names profile's cases (dist.48)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const supertype = (c as { supertype?: string }).supertype;
      expect(typeName(c.type, { names: c.map, supertype, many: c.many === true })).toBe(c.word ?? standard(c.type, c.many === true));
    });
  }
});

describe('a world without a map prints what Lantern printed before', () => {
  it('every type, both forms, both casings', () => {
    setTypeWordsSource(() => ({}));
    for (const t of ELEMENT_TYPES) {
      expect(typeLabel(t)).toBe(t[0].toUpperCase() + t.slice(1));
      expect(typePlural(t)).toBe(getElementLabel(t));
      expect(typeName(t)).toBe(t);
      expect(typeName(t, { many: true })).toBe(getElementLabel(t).toLowerCase());
    }
    setTypeWordsSource(() => null);
  });
});

describe("the open world's words", () => {
  const names = { version: 1, types: { character: { one: 'Employee', many: 'Employees' } }, supertypes: { character: { Agent: { one: 'AI agent' } } } };

  it('come from the open world and print as written', () => {
    setTypeWordsSource(() => ({ names }));
    expect(typeLabel('character')).toBe('Employee');
    expect(typeName('character')).toBe('Employee');
    expect(typeLabel('character', 'agent')).toBe('AI agent');
    expect(typeCount(3, 'character')).toBe('3 Employees');
    expect(typeCount(1, 'character')).toBe('1 Employee');
    expect(aTypeName('character')).toBe('an Employee');
    expect(typeName('location')).toBe('location');
    setTypeWordsSource(() => null);
    expect(typeLabel('character')).toBe('Character');
    expect(typeCount(2, 'family')).toBe('2 families');
  });

  it("name a supertype only when the world has a word for it (Seethe h20 #11028)", () => {
    setTypeWordsSource(() => ({ names }));
    expect(supertypeWord('character', 'Agent')).toBe('AI agent');
    expect(supertypeWord('character', 'Hero')).toBeNull(); // the type's word, not the supertype's
    expect(supertypeWord('character', '')).toBeNull();
    setTypeWordsSource(() => null);
    expect(supertypeWord('character', 'Agent')).toBeNull();
  });
});
