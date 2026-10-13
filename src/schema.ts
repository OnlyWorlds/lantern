// What the schema says about a type: its fields in display order, and how a type looks.
// Everything comes from the SDK (FIELD_SCHEMA, ELEMENT_SECTIONS, FAMILY_COLORS); nothing is restated.
import {
  ELEMENT_FAMILIES,
  ELEMENT_SECTIONS,
  ELEMENT_TYPES,
  FIELD_SCHEMA,
  elementColor,
  getElementLabel,
  type ElementType,
  type FieldInfo,
} from '@onlyworlds/sdk';

export const TYPES: ElementType[] = ELEMENT_TYPES;
export const BASE_FIELDS = ['name', 'description', 'supertype', 'subtype', 'image_url'];

export function isType(t: string): t is ElementType {
  return t in ELEMENT_FAMILIES;
}

export function fieldInfo(type: string, field: string): FieldInfo | undefined {
  if (!isType(type)) return undefined;
  return (FIELD_SCHEMA as unknown as Record<string, Record<string, FieldInfo>>)[type][field];
}

export interface FieldRow {
  field: string;
  info: FieldInfo;
  section: string;
}

/** The type's fields after the base ones, in the schema's section order. */
export function typeFields(type: string): FieldRow[] {
  if (!isType(type)) return [];
  const all = (FIELD_SCHEMA as unknown as Record<string, Record<string, FieldInfo>>)[type];
  const rows: FieldRow[] = [];
  const seen = new Set(BASE_FIELDS);
  for (const sec of [...ELEMENT_SECTIONS[type]].sort((a, b) => a.order - b.order)) {
    for (const f of sec.fields) {
      if (seen.has(f) || !all[f]) continue;
      seen.add(f);
      rows.push({ field: f, info: all[f], section: sec.name });
    }
  }
  for (const [f, info] of Object.entries(all)) {
    if (!seen.has(f)) rows.push({ field: f, info, section: 'Other' });
  }
  return rows;
}

/** "Characters" */
export function typePlural(type: string): string {
  return isType(type) ? getElementLabel(type) : type;
}

/** "Character" */
export function typeLabel(type: string): string {
  return type ? type[0].toUpperCase() + type.slice(1) : '';
}

/** "Ch": the two letters on a type chip, beside the type's name in words. */
export function typeAbbr(type: string): string {
  return typeLabel(type).slice(0, 2);
}

export function typeColor(type: string): string {
  return isType(type) ? elementColor(type, 'dark') : '#888888';
}

// A custom field is a key the world's maker added (Atlas: type "mood", it stores x_mood). keel
// passes extension keys through as written; atlas_ keys are Atlas's machinery and stay hidden.
// The prefixes are Atlas's (its EXTENSION_FIELD_NAMESPACES, minus atlas_).
const CUSTOM_PREFIXES = ['x_', 'shadow_'];

export function isCustomField(field: string): boolean {
  return CUSTOM_PREFIXES.some((p) => field.startsWith(p) && field.length > p.length);
}

/** The element's custom fields, by label; null is a deleted one (Atlas's tombstone), never shown. */
export function customFields(el: Record<string, unknown>): string[] {
  return Object.keys(el)
    .filter((f) => isCustomField(f) && el[f] !== null && el[f] !== undefined)
    .sort((a, b) => fieldLabel(a).localeCompare(fieldLabel(b)) || (a < b ? -1 : 1));
}

/** Only text and numbers are changed on the phone; a list or a group of values is Atlas's to edit. */
export function customEditable(v: unknown): boolean {
  return typeof v === 'string' || typeof v === 'number';
}

/** "birth_date" to "Birth date", "x_eye_colour" to "Eye colour"; the stat block stays as written (STR, DEX). */
export function fieldLabel(field: string): string {
  const bare = CUSTOM_PREFIXES.reduce((f, p) => (isCustomField(f) && f.startsWith(p) ? f.slice(p.length) : f), field);
  if (bare === bare.toUpperCase()) return bare;
  const s = bare.replace(/_/g, ' ').trim() || bare;
  return s[0].toUpperCase() + s.slice(1);
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}
