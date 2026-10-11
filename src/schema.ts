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

/** "birth_date" to "Birth date"; the stat block stays as written (STR, DEX). */
export function fieldLabel(field: string): string {
  if (field === field.toUpperCase()) return field;
  const s = field.replace(/_/g, ' ');
  return s[0].toUpperCase() + s.slice(1);
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}
