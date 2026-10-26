// Custom fields: the world maker's own keys, as Atlas writes them (x_mood), shown,
// found and kept; Atlas's machinery (atlas_) never shown; a null is a deleted one.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { customEditable, customFieldKey, customFieldProblem, customFields, fieldLabel, isCustomField, isProfileField } from '../src/schema';
import { search } from '../src/search';
import { openWorldFile, toWorldFile } from '../src/worldfile';
import * as db from '../src/db';
import type { OwElement } from '@onlyworlds/sdk';

describe('custom fields', () => {
  it('are the x_ and shadow_ keys with a value, never atlas_ ones or a bare prefix', () => {
    const el = { id: '1', type: 'character', name: 'Ada', x_mood: 'grim', shadow_true_name: 'Ash', x_gone: null, atlas_aliases: ['A'], x_: 'odd', description: 'd' };
    expect(customFields(el)).toEqual(['x_mood', 'shadow_true_name']);
    expect(isCustomField('atlas_page')).toBe(false);
    expect(isCustomField('x_')).toBe(false);
  });

  it('read as Atlas names them, without the prefix', () => {
    expect(fieldLabel('x_eye_colour')).toBe('Eye colour');
    expect(fieldLabel('shadow_true_name')).toBe('True name');
    expect(fieldLabel('x_STR')).toBe('STR');
    expect(fieldLabel('birth_date')).toBe('Birth date');
    expect(fieldLabel('image_url')).toBe('Image URL');           // the SDK's house rule (4.34)
    expect(fieldLabel('x_Eye_Colour')).toBe('Eye colour');
    expect(fieldLabel('x_max_HP')).toBe('Max HP');               // a word in capitals kept (4.36)
  });

  it("a typed name is stored as Atlas stores it, and refused where Atlas refuses it", () => {
    expect(customFieldKey('Eye colour')).toBe('x_eye_colour');
    expect(customFieldKey('  Façade—Ward! ')).toBe('x_façade_ward');
    expect(customFieldKey('x_Mood')).toBe('x_mood');
    expect(customFieldKey('shadow_true name')).toBe('shadow_true_name');
    expect(customFieldKey('!!!')).toBe('');
    const el = { type: 'character', x_mood: 'grim', x_gone: null };
    expect(customFieldProblem(el, '')).toMatch(/Give the field a name/);
    expect(customFieldProblem(el, customFieldKey('atlas_page'))).toMatch(/kept for Atlas/);
    expect(customFieldProblem(el, customFieldKey('Height'))).toMatch(/already a field of every Character/);
    expect(customFieldProblem(el, customFieldKey('description'))).toMatch(/already a field/);
    expect(customFieldProblem(el, customFieldKey('Mood'))).toMatch(/already on this Character/);
    expect(customFieldProblem(el, customFieldKey('Gone'))).toBeNull(); // a removed one can come back
  });

  it('only text and numbers change on the phone', () => {
    expect(customEditable('grim')).toBe(true);
    expect(customEditable(3.5)).toBe(true);
    expect(customEditable(['a'])).toBe(false);
    expect(customEditable({ a: 1 })).toBe(false);
    expect(customEditable(true)).toBe(false);
  });

  it('are found by find, after the name, kind and description', () => {
    const els = [
      { id: '1', type: 'character', name: 'Ada', x_mood: 'Grimly cheerful' },
      { id: '2', type: 'character', name: 'Bo', description: 'grim' },
      { id: '3', type: 'character', name: 'Cy', x_tags: ['harbour', 'grim'], atlas_note: 'grim' },
      { id: '4', type: 'character', name: 'Di', atlas_note: 'grim' },
    ] as unknown as OwElement[];
    const hits = search(els, 'grim');
    expect(hits.map((x) => [x.el.name, x.where])).toEqual([
      ['Bo', 'description'],
      ['Cy', 'custom'], // a rank's ties go by the shorter name
      ['Ada', 'custom'],
    ]);
  });

  it("a world's clock survives Save a copy and Open a world file, under Atlas's folder names", async () => {
    const rec = { id: 'w0000000-0000-4000-8000-0000000000c2', name: 'Clock round trip', kind: 'local' as const, addedAt: '', timeNow: 453, timeUnit: 'Year' };
    const { bytes } = toWorldFile(rec, []);
    const id = await openWorldFile(bytes);
    const back = await db.getWorldRecord(id);
    expect([back?.timeNow, back?.timeUnit]).toEqual([453, 'Year']);
  });

  it('survive Save a copy and Open a world file', async () => {
    const els = [{ id: 'c1111111-0000-4000-8000-000000000001', type: 'character', name: 'Ada', x_mood: 'grim', x_height_cm: 172, x_tags: ['a', 'b'] }];
    const { bytes } = toWorldFile({ id: 'w0000000-0000-4000-8000-0000000000c1', name: 'Custom round trip', kind: 'local', addedAt: '' }, els);
    const id = await openWorldFile(bytes);
    const back = (await db.allElements(id))[0] as unknown as Record<string, unknown>;
    expect([back.x_mood, back.x_height_cm, back.x_tags]).toEqual(['grim', 172, ['a', 'b']]);
  });

  it('an identity key (x_identity_key) cannot be named, and is kept apart for read-only', () => {
    const key = customFieldKey('Identity key');
    expect(key).toBe('x_identity_key');
    expect(customFieldProblem({ id: '1', type: 'character' }, key)).toMatch(/identity key/i);
    expect(customFieldProblem({ id: '1', type: 'character' }, 'x_identity')).toBeNull();
    expect(isProfileField('x_identity_key')).toBe(true);
    expect(isProfileField('x_mood')).toBe(false);
    // A work packet's keys (dist.36's packet profile) are kept the same way.
    expect(customFieldProblem({ id: '1', type: 'relation' }, customFieldKey('Packet elements'))).toMatch(/work packet/i);
    expect(isProfileField('x_packet_source')).toBe(true);
    expect(isProfileField('x_packets')).toBe(false);
    // And a review mark's (dist.37's review profile).
    expect(customFieldProblem({ id: '1', type: 'character' }, customFieldKey('Review checked'))).toMatch(/review mark/i);
    expect(isProfileField('x_review_proposed')).toBe(true);
    // And a work world's checks (dist.47's checks profile).
    expect(customFieldProblem({ id: '1', type: 'law' }, customFieldKey('Checks rules'))).toMatch(/checks/i);
    expect(isProfileField('x_checks_rules')).toBe(true);
    expect(isProfileField('x_checks')).toBe(false);
    // And a spine's rows (dist.55's spine profile).
    expect(customFieldProblem({ id: '1', type: 'object' }, customFieldKey('Spine status'))).toMatch(/spine/i);
    expect(isProfileField('x_spine_depends_on')).toBe(true);
    expect(isProfileField('x_spines')).toBe(false);
  });
});
