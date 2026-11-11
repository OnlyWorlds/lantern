import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { leadAndRest, typeFields } from '../src/schema';

const el = (o: Record<string, unknown>) => ({ id: 'n1', name: 'x', ...o }) as unknown as OwElement;

describe('leadAndRest', () => {
  it("leads a message with its story and keeps every other row in the schema's order", () => {
    const { lead, rest } = leadAndRest(el({ type: 'narrative', supertype: 'Message' }));
    expect(lead.map((r) => r.field)).toEqual(['story']);
    expect(rest.map((r) => r.field)).toEqual(typeFields('narrative').map((r) => r.field).filter((f) => f !== 'story'));
  });

  it('leaves a narrative that is not a message, and any other type, as the schema has it', () => {
    for (const o of [{ type: 'narrative' }, { type: 'narrative', supertype: 'Saga' }, { type: 'character' }]) {
      const { lead, rest } = leadAndRest(el(o));
      expect(lead).toEqual([]);
      expect(rest.map((r) => r.field)).toEqual(typeFields(o.type).map((r) => r.field));
    }
  });
});
