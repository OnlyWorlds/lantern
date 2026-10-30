import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES } from '@onlyworlds/sdk';
import { isType } from '../src/schema';

describe('isType', () => {
  it('knows the 22 types and nothing on the prototype', () => {
    for (const t of ELEMENT_TYPES) expect(isType(t)).toBe(true);
    for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'Character', '']) expect(isType(t)).toBe(false);
  });
});
