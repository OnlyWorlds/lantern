// The morning after's write run: a fixed plan done step by step, the step kept after each, so a
// retry resumes where it stopped and nothing is made or appended twice (the S398 sort gate). Its
// own module so the tests drive the loop the screen runs, not a copy of it (the S399 merge gate).
import { SORTED, type Write } from './sortplan';
import type { WorldSession } from './world';
import { uuid7 } from './uuid7';

/** The plan as it is fixed: each create gets its id and key now, kept with the plan, never at send time. */
export function fixPlan(writes: Write[]): Write[] {
  return writes.map((w) => (w.op === 'create' && !w.id ? { ...w, id: uuid7(), idempotencyKey: uuid7() } : w));
}

export interface WriteRun {
  plan: Write[];
  notes: string[];
  step?: number;
}

/** Runs `k` from its step to the end, calling `save` after each step. Returns how many planned edits found their element gone. */
export async function runWrites(s: WorldSession, k: WriteRun, save: () => void): Promise<{ gone: number }> {
  const steps = k.plan.length + k.notes.length;
  let gone = 0;
  while ((k.step ?? 0) < steps) {
    const i = k.step ?? 0;
    if (i < k.plan.length) {
      const w = k.plan[i];
      if (w.op === 'create') await s.create(w.type, w.values, undefined, w.id && w.idempotencyKey ? { id: w.id, idempotencyKey: w.idempotencyKey } : undefined);
      // Removed elsewhere since the plan was fixed: nothing left to add to; the rest goes on.
      else if (!s.get(w.id)) gone++;
      // Judged against keel's copy when the plan was fixed, so a change made since is a conflict.
      else await s.edit(w.id, w.values, w.base ?? s.serverCopy(w.id));
    } else {
      // The notes are filed, not deleted: every written row points at its note.
      const id = k.notes[i - k.plan.length];
      if (s.get(id)) await s.edit(id, { supertype: SORTED }, s.serverCopy(id));
    }
    k.step = i + 1;
    save();
  }
  return { gone };
}
