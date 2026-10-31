// Where an element has been on OnlyWorlds (the Waymark's trail; Atlas's twin): the tools that
// wrote it, newest first, for the element page's foot. keel's `doors` (members only) holds one
// key per tool that wrote the element, its client name or, for a write that named none, its door
// word, each with that tool's last write time. The SDK's `doorsOf` reads it (falling back to the
// last write's `changed_client` or `changed_via` for an element without it) and `doorWhere` says
// each one in the Waymark's words ("in Atlas", "on onlyworlds.com", "with an AI", "by OnlyWorlds",
// "in code"). No "by you": the trail claims nothing past the door.
//
// keel serves `doors` on an element read and a write's answer, never in /changes (the feed is the
// trail already), so the copy a pull brings holds only its last write. The page reads the element
// (`WorldSession.doors`), and the trail is the newest of the two records, whole: never a merge,
// since keel moves `updated_at` without a door when it scrubs a link to a deleted element, and a
// copy's last write read at that time would name a door keel never recorded (the S523 gate's M1).
import { doorsOf, doorWhere, isKnownOf, type OwElement } from '@onlyworlds/sdk';
import { ago } from './dom';

export interface TrailStep {
  where: string;
  at: string;
}

/** keel's answer to a read of the element: its door record and the time it was read at. */
export interface DoorRead {
  doors: Record<string, unknown> | null;
  updated_at: string | null;
}

/** Is this read at least as new as the copy? (A copy with no time is older than any read.) */
export function readCovers(read: DoorRead | null | undefined, copyUpdated: unknown): boolean {
  if (!read || !read.updated_at) return false;
  const copy = typeof copyUpdated === 'string' ? Date.parse(copyUpdated) : NaN;
  return !Number.isFinite(copy) || Date.parse(read.updated_at) >= copy;
}

/** The element's trail, newest first, one step per phrase; empty when OnlyWorlds has said nothing of it, or on a stub. */
export function doorTrail(el: OwElement, read?: DoorRead | null): TrailStep[] {
  if (isKnownOf(el)) return [];
  const source = readCovers(read, el.updated_at) ? { updated_at: read!.updated_at, doors: read!.doors } : el;
  const seen = new Set<string>();
  const out: TrailStep[] = [];
  for (const d of doorsOf(source)) {
    const where = doorWhere(d);
    if (seen.has(where)) continue; // "in code" stands for many doors: its newest says it
    seen.add(where);
    out.push({ where, at: d.at });
  }
  return out;
}

/** The page's lines: "On OnlyWorlds: last shaped in Atlas, 3 min ago", then "Before that: ..." when there is more. */
export function trailLines(el: OwElement, read?: DoorRead | null): string[] {
  const steps = doorTrail(el, read);
  if (steps.length === 0) return [];
  const step = (s: TrailStep) => `${s.where}, ${ago(s.at)}`;
  const out = [`On OnlyWorlds: last shaped ${step(steps[0])}`];
  if (steps.length > 1) out.push(`Before that: ${steps.slice(1).map(step).join(' · ')}`);
  return out;
}
