// The Idempotency-Key for a call through keel's AI door (POST /account/ai/<use>). keel keeps a 200
// under its key for 24 hours (replayed, billed nothing) and releases the key on any failure. A call
// whose answer never arrived (no connection, still running) is sent again under the same key, so
// keel hands back the answer it already made and bills nothing. Once an answer lands, the key is
// spent: the same question asked again is a new call with a new answer, as before the door.
// Held in memory: a reload forgets it, and the next send is a new call.

const unanswered = new Map<string, string>();
const slot = (use: string, body: unknown) => `${use}\n${JSON.stringify(body)}`;

/** The key for this call: the one its last unanswered send used, or a new one. */
export function aiKey(use: string, body: unknown): string {
  const s = slot(use, body);
  let key = unanswered.get(s);
  if (!key) {
    key = `lantern-${use}-${crypto.randomUUID()}`;
    unanswered.set(s, key);
  }
  return key;
}

/** An answer landed for this call: its key is spent. */
export function aiAnswered(use: string, body: unknown): void {
  unanswered.delete(slot(use, body));
}
