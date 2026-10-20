// What the schema says about a type: its fields in display order, and how a type looks.
// Everything comes from the SDK (FIELD_SCHEMA, ELEMENT_SECTIONS, FAMILY_COLORS); nothing is restated.
import {
  ELEMENT_FAMILIES,
  ELEMENT_SECTIONS,
  ELEMENT_TYPES,
  FIELD_SCHEMA,
  elementColor,
  fieldLabel as houseFieldLabel,
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

/**
 * An element with the deleted ids taken out of its link fields (a single link to null, a multi link
 * filtered), or null when it links to none of them. keel does the same on a delete, for every element,
 * in the delete's own transaction; a world on this phone does it here, and the screen does it while
 * a delete waits to send.
 */
export function withoutLinksTo<T extends { type: string } & Record<string, unknown>>(el: T, gone: ReadonlySet<string>): T | null {
  if (!isType(el.type) || !gone.size) return null;
  const all = (FIELD_SCHEMA as unknown as Record<string, Record<string, FieldInfo>>)[el.type];
  let next: T | null = null;
  for (const [f, info] of Object.entries(all)) {
    const v = el[f];
    if (info.type === 'single_link' && typeof v === 'string' && gone.has(v)) {
      next ??= { ...el };
      (next as Record<string, unknown>)[f] = null;
    } else if (info.type === 'multi_link' && Array.isArray(v) && v.some((x) => gone.has(String(x)))) {
      next ??= { ...el };
      (next as Record<string, unknown>)[f] = v.filter((x) => !gone.has(String(x)));
    }
  }
  return next;
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

/**
 * The key a typed name is stored under, as Atlas makes it (`normalizeCustomFieldName`, Atlas
 * element-detail-custom-fields.ts): "Eye colour" is x_eye_colour; a typed x_ or shadow_ prefix is
 * kept; atlas_ keeps its prefix so the check below refuses it. Empty when nothing is left.
 */
export function customFieldKey(input: string): string {
  let raw = input.trim().toLowerCase();
  let prefix = 'x_';
  if (raw.startsWith('x_')) raw = raw.slice(2);
  else if (raw.startsWith('shadow_')) {
    prefix = 'shadow_';
    raw = raw.slice(7);
  } else if (raw.startsWith('atlas_')) {
    prefix = 'atlas_';
    raw = raw.slice(6);
  }
  const slug = raw
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug ? prefix + slug : '';
}

/** Why a key cannot be added to this element, in a sentence, or null when it can. */
export function customFieldProblem(el: { type: string; [k: string]: unknown }, key: string): string | null {
  if (!key) return 'Give the field a name.';
  if (key.startsWith('atlas_')) return 'Names starting with atlas_ are kept for Atlas. Pick another.';
  const bare = key.replace(/^(x_|shadow_)/, '');
  if (BASE_FIELDS.includes(bare) || fieldInfo(el.type, bare)) return `${fieldLabel(bare)} is already a field of every ${typeLabel(el.type)}: use that one.`;
  if (el[key] !== undefined && el[key] !== null) return `${fieldLabel(key)} is already on this ${typeLabel(el.type)}.`;
  return null;
}

/** Only text and numbers are changed on the phone; a list or a group of values is Atlas's to edit. */
export function customEditable(v: unknown): boolean {
  return typeof v === 'string' || typeof v === 'number';
}

/**
 * "birth_date" to "Birth date", "image_url" to "Image URL", "x_eye_colour" to "Eye colour", "x_STR" to
 * "STR": the SDK's one copy of the house rule (4.34; a word in capitals kept as written since 4.36,
 * Kael h63 #8201), after Lantern's own step: the custom prefix goes.
 */
export function fieldLabel(field: string): string {
  const bare = CUSTOM_PREFIXES.reduce((f, p) => (isCustomField(f) && f.startsWith(p) ? f.slice(p.length) : f), field);
  return houseFieldLabel(bare.replace(/^_+|_+$/g, '')) || bare;
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}
