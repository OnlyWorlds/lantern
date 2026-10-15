// One open world: its elements in memory, the outbox laid over them, and the two directions of
// sync. The store holds the server's truth; what the screen shows is that truth with every
// waiting edit laid on top, so "waiting to send" is always computed, never remembered.
import {
  OwNetworkError,
  OwPreconditionFailedError,
  OwV2Client,
  OwApiError,
  detectKeyKind,
  isDemoKey,
  buildWorldIndex,
  type OwWorldIndex,
  kindCanWrite,
  type OwElement,
  type OwMember,
} from '@onlyworlds/sdk';
import * as db from './db';
import type { OutboxRow, WorldRecord } from './db';
import { uuid7 } from './uuid7';
import { isEmptyValue, withoutLinksTo } from './schema';
import { pinFor, setPin } from './pin';
import { calendarOf, clockFrom } from './time';
import { chooseCalendar, chosenCalendar } from './calendarpick';
import type { CalendarConfig } from '@onlyworlds/sdk';

export const API_BASE = 'https://www.onlyworlds.com/api/v2';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/** Set while the running build is older than the one on the server: the outbox holds (Boss #3391). */
let buildBehind = false;
export function setBuildBehind(v: boolean): void {
  buildBehind = v;
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (isEmptyValue(v)) return null;
    if (Array.isArray(v)) return [...v].map(String).sort();
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** The 412 rule: the server's copy moved, but did it move on a field this edit touches? */
export function movedFields(row: OutboxRow, current: OwElement): string[] {
  const base = (row.base ?? {}) as Record<string, unknown>;
  // A field that already holds my value is no conflict (my send landed, its answer was lost).
  return Object.keys(row.values).filter((f) => !sameValue(base[f], current[f]) && !sameValue(row.values[f], current[f]));
}

const sessions = new Map<string, Promise<WorldSession>>();


/** keel's head is a change_seq; one below the head this phone applied means a rewind. */
export function headBehind(head: unknown, applied: unknown): boolean {
  const h = Number(head);
  const a = Number(applied);
  return head != null && applied != null && Number.isFinite(h) && Number.isFinite(a) && h < a;
}

/**
 * Whether this phone can change the world: one on this phone, or a write key (not the demo). A
 * player never does, whatever their key: a player's write key is only for sharing a note.
 */
export function recordCanWrite(rec: WorldRecord): boolean {
  if (rec.kind === 'local') return true;
  if (rec.kind === 'demo' || !rec.apiKey || isDemoKey(rec.apiKey)) return false;
  if (rec.memberRole === 'guest') return false;
  return kindCanWrite(rec.keyKind ?? detectKeyKind(rec.apiKey));
}

export function openWorld(id: string): Promise<WorldSession> {
  let p = sessions.get(id);
  if (!p) {
    p = WorldSession.load(id);
    sessions.set(id, p);
    p.catch(() => sessions.delete(id));
  }
  return p;
}

// A forgotten session may still have a read or a send in flight. Each forget bumps the world's
// generation, and a session from an older one writes nothing more: after a world is opened under
// another key, the old key's walk must not put its pages or its cursor back (the S402 gate, G2).
const generations = new Map<string, number>();
const RETIRED = new Error('retired');

export function forgetSession(id: string): void {
  sessions.delete(id);
  generations.set(id, (generations.get(id) ?? 0) + 1);
}

export class WorldSession {
  rec: WorldRecord;
  private readonly generation: number;
  /** Let go (forgetSession): what it was doing ends without writing. */
  get retired(): boolean {
    return (generations.get(this.rec.id) ?? 0) !== this.generation;
  }
  /** The server's truth (or, for a world on this phone only, the only truth). */
  private truth = new Map<string, OwElement>();

  /** Is this copy at least as new as the one held? (change_seq is last-write order.) */
  private isNewer(el: OwElement): boolean {
    const held = this.truth.get(el.id);
    return !held || (el.change_seq ?? 0) >= (held.change_seq ?? 0);
  }

  /** A row leaves the outbox with the server's answer, which lands only if it is the newer copy. */
  private async settle(row: OutboxRow, answer: OwElement): Promise<void> {
    const el = { ...answer, type: answer.type || row.type };
    const take = this.isNewer(el);
    await db.settleOutboxRow(this.id, row.seq!, take ? el : null);
    this.outbox = this.outbox.filter((r) => r !== row);
    if (take) {
      this.truth.set(el.id, el);
      this.settledDuringWalk?.add(el.id);
    }
  }
  /** Deleted from this phone this session: their links stay hidden until keel's scrubbed copies arrive. */
  private deletedHere = new Set<string>();
  /** Ids whose send settled while a fresh read was walking; the swap keeps their answers. */
  private settledDuringWalk: Set<string> | null = null;
  outbox: OutboxRow[] = [];
  /** What the screen shows: truth with the outbox laid on top. */
  view = new Map<string, OwElement>();
  status: SyncStatus = 'idle';
  statusText = '';
  needPin = false;
  private listeners = new Set<() => void>();
  private backlinkCache: Map<string, string[]> | null = null;
  private calendarCache: CalendarConfig | null | undefined = undefined;
  private lookupCache: OwWorldIndex<OwElement> | null = null;
  private pulling: Promise<void> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private queuedFlush: Promise<void> | null = null;
  private retryTimer: number | undefined;

  private constructor(rec: WorldRecord) {
    this.rec = rec;
    this.generation = generations.get(rec.id) ?? 0;
  }

  static async load(id: string): Promise<WorldSession> {
    const rec = await db.getWorldRecord(id);
    if (!rec) throw new Error('This world is not on this phone.');
    const s = new WorldSession(rec);
    for (const el of await db.allElements(id)) s.truth.set(el.id, el);
    s.outbox = await db.outboxRows(id);
    // A row caught mid-send when the app closed goes back to waiting: a create carries its
    // Idempotency-Key and a patch its If-Match, so sending it again is safe.
    for (const r of s.outbox) {
      if (r.state === 'sending') {
        r.state = 'waiting';
        await db.putOutboxRow(id, r);
      }
    }
    s.rebuild();
    return s;
  }

  get id(): string {
    return this.rec.id;
  }

  get isLocal(): boolean {
    return this.rec.kind === 'local';
  }

  get canWrite(): boolean {
    return recordCanWrite(this.rec);
  }

  /** A world this key only reads (a player's, a lent read key), not the demo: notes stay on the phone. */
  get takesNotes(): boolean {
    return !this.canWrite && this.rec.kind !== 'demo';
  }

  private rosterRows: OwMember[] | null = null;
  private rosterAsked = false;

  /**
   * The world's roster (keel's GET /members on the world's own key), for the quiet agent mark
   * (#347): it names an agent seat. Asked once per session, only when a page needs a name and the
   * phone has signal; a refusal stays quiet (the mark says "an agent" without the name).
   */
  roster(): OwMember[] | null {
    if (!this.rosterAsked && !this.isLocal && this.rec.kind !== 'demo' && this.rec.apiKey && navigator.onLine) {
      this.rosterAsked = true;
      this.client(false).members().then(
        (rows) => {
          if (this.retired) return;
          this.rosterRows = rows;
          this.emit();
        },
        () => {},
      );
    }
    return this.rosterRows;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Who this key is in the world (keel's GET /me with the world's own key, Skeld #3457), asked
   * on each launch: a player's own Character (the owner may give one later), and the member role
   * for a world opened with a key.
   */
  async learnWhoIAm(): Promise<void> {
    if (this.isLocal || this.rec.kind === 'demo' || !this.rec.apiKey) return;
    try {
      const me = await this.client(false).me();
      // The SDK types the role as open (a new one may come); Lantern knows these three.
      const role = me.role === 'guest' ? 'guest' : me.role === 'co_builder' ? 'co_builder' : me.role === 'contributor' ? 'contributor' : undefined;
      const rec = await db.updateWorldRecord(this.id, {
        characterId: role === 'guest' && typeof me.character === 'string' ? me.character : null,
        // A world from the account list keeps the list's role; one opened with a key takes keel's.
        ...(this.rec.role ? {} : { memberRole: role }),
      });
      if (rec) {
        this.rec = rec;
        this.emit();
      }
    } catch {
      /* no signal, or an older keel: asked again on the next open */
    }
  }

  /** A player (a guest of the world, Keel #213), on any key. */
  get isPlayer(): boolean {
    return this.rec.memberRole === 'guest' && this.rec.kind === 'online';
  }

  /** A player's key that can send a shared note (a member write key; a read key cannot). */
  get playerCanSend(): boolean {
    const key = this.rec.apiKey;
    return this.isPlayer && !!key && kindCanWrite(this.rec.keyKind ?? detectKeyKind(key));
  }

  /**
   * A player's write key for the same membership, taken for their first shared note (the Captain
   * h37 #4420). The same membership sees the same world, so the copy and the feed's cursor stay.
   * The key is the signed-in account's membership, so the PIN asked is that account's (a world
   * opened with a key had no account role until now).
   */
  async takePlayerKey(apiKey: string): Promise<void> {
    const rec = await db.updateWorldRecord(this.id, { apiKey, keyKind: detectKeyKind(apiKey), role: this.rec.role ?? 'collaborator' });
    if (rec) {
      this.rec = rec;
      this.emit();
    }
  }

  /**
   * A player's note shared with the party (keel #241): a Narrative from the player's key, through
   * the outbox like any change, so a note shared without signal goes when there is some. keel
   * fills in `narrator` (the player's own Character) and refuses any Collective theirs is not in.
   */
  async shareNote(values: Record<string, unknown>, id: string): Promise<string> {
    if (!this.playerCanSend) throw new Error('This key cannot share notes.');
    return this.queueCreate('narrative', values, undefined, undefined, id);
  }

  /** A refused row for an element, still in the outbox (said where the element is shown). */
  refusedRow(id: string): OutboxRow | undefined {
    return this.outbox.find((r) => r.id === id && r.state === 'refused');
  }

  /** Which Collective is the party, kept for this world on this phone. */
  async rememberParty(partyId: string): Promise<void> {
    const rec = await db.updateWorldRecord(this.id, { partyId });
    if (rec) this.rec = rec;
  }

  /** Re-render whoever is watching (an app-wide change, such as a newer build). */
  touch(): void {
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---------- reading the overlay ----------

  private rebuild(): void {
    this.view = new Map(this.truth);
    const gone = new Set(this.deletedHere);
    for (const row of [...this.outbox].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      if (row.state === 'refused') continue;
      if (row.op === 'delete') {
        gone.add(row.id);
        continue;
      }
      const cur = this.view.get(row.id) ?? ({ id: row.id, type: row.type, name: '' } as OwElement);
      const next = { ...cur, ...row.values, type: row.type, id: row.id };
      // A photo waiting to be uploaded shows as itself, from the phone.
      if (row.photo) next.image_url = photoUrl(row.photo);
      this.view.set(row.id, next);
    }
    // A delete waiting to send (or sent, until keel's scrubbed copies arrive) leaves the screen
    // whole: the element goes, and so do the links to it, as keel removes them.
    for (const id of gone) this.view.delete(id);
    if (gone.size) {
      for (const [id, el] of this.view) {
        const scrubbed = withoutLinksTo(el, gone);
        if (scrubbed) this.view.set(id, scrubbed);
      }
    }
    this.backlinkCache = null;
    this.calendarCache = undefined;
    this.lookupCache = null;
  }

  /** Kael's lookup index (SDK buildWorldIndex) over what the screen shows, built on first ask. */
  lookupIndex(): OwWorldIndex<OwElement> {
    this.lookupCache ??= buildWorldIndex(this.view.values());
    return this.lookupCache;
  }

  get(id: string): OwElement | undefined {
    return this.view.get(id);
  }

  elements(): OwElement[] {
    return [...this.view.values()];
  }

  ofType(type: string): OwElement[] {
    return this.elements()
      .filter((e) => e.type === type)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  }

  counts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of this.view.values()) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }

  /** The fields of an element that are waiting to send, and the state of the row holding them. */
  pending(id: string): Map<string, OutboxRow> {
    const m = new Map<string, OutboxRow>();
    for (const row of this.outbox) {
      if (row.id !== id || row.state === 'refused') continue;
      for (const f of Object.keys(row.values)) m.set(f, row);
      if (row.photo) m.set('image_url', row);
      if (row.op === 'create') m.set('*', row);
    }
    return m;
  }

  /** The world's calendar (src/time.ts `calendarOf`), worked out once per change. */
  calendar(): CalendarConfig | null {
    if (this.calendarCache === undefined) this.calendarCache = calendarOf(this.view.values(), chosenCalendar(this.id));
    return this.calendarCache;
  }

  /** Which calendar this world's dates are in on this phone (`null`: the numbers). */
  pickCalendar(id: string | null): void {
    chooseCalendar(this.id, id);
    this.calendarCache = undefined;
    this.emit();
  }

  /** Elements whose link fields point at this one. */
  backlinks(id: string): string[] {
    if (!this.backlinkCache) {
      const m = new Map<string, string[]>();
      for (const el of this.view.values()) {
        for (const [k, v] of Object.entries(el)) {
          if (k === 'id' || k === 'created_by') continue;
          const ids = Array.isArray(v) ? v : typeof v === 'string' && v.length === 36 && v[8] === '-' ? [v] : [];
          for (const t of ids) {
            if (typeof t !== 'string' || t === el.id) continue;
            const list = m.get(t);
            if (list) {
              if (!list.includes(el.id)) list.push(el.id);
            } else m.set(t, [el.id]);
          }
        }
      }
      this.backlinkCache = m;
    }
    return this.backlinkCache.get(id) ?? [];
  }

  waitingCount(): number {
    return this.outbox.filter((r) => r.state === 'waiting' || r.state === 'sending').length;
  }

  needsYouCount(): number {
    return this.outbox.filter((r) => r.state === 'needs-you' || r.state === 'gone' || r.state === 'refused').length;
  }

  /** A PIN is held for this world now (one entered on another of your worlds counts). */
  pinKnown(): boolean {
    return !!pinFor(this.rec);
  }

  /**
   * Who may move the world's now from this phone: keel lets the owner change a world's own settings,
   * and a co-builder change its now alone (Keel #240, live in 36b3010, Skeld h37 #4214); a
   * contributor or a guest gets 403 owner_only. A key with no account role may be the owner's own:
   * it is let try, and keel's answer is said.
   */
  get canMoveNow(): boolean {
    if (this.isLocal) return true;
    if (!this.canWrite) return false;
    // The member role, from the account list or learned from /me for a key (the S402 gate, G4).
    if (this.rec.memberRole) return this.rec.memberRole === 'co_builder';
    return this.rec.role !== 'collaborator';
  }

  /**
   * Move the world's now (Before now; the Captain h37 #4087). A world setting, not an element: it
   * goes at once with the PIN, never through the outbox, so it needs signal; a world on this
   * phone only keeps it here. The caller asks for the PIN first when none is held.
   */
  async setNow(n: number): Promise<void> {
    if (!Number.isInteger(n)) throw new Error('A whole number, please.');
    if (!this.isLocal) {
      if (!navigator.onLine) throw new Error('Moving now needs signal. Try again when you have it.');
      try {
        const meta = await this.client(true).patchWorld({ time_range_current: n });
        const k = clockFrom(meta as unknown as Record<string, unknown>);
        n = k.now ?? n;
        if (k.unit) this.rec = { ...this.rec, timeUnit: k.unit };
      } catch (e) {
        if (e instanceof OwApiError && e.isOwnerOnly) throw new Error("Only the world's owner or a co-builder can move its now.");
        if (e instanceof OwApiError && e.status === 401) {
          // A wrong PIN: cleared, never retried (keel throttles wrong PINs).
          setPin(this.rec, undefined);
          throw new Error('That PIN was not right. Enter it again and try once more.');
        }
        throw e;
      }
    }
    const rec = await db.updateWorldRecord(this.id, { timeNow: n, timeUnit: this.rec.timeUnit });
    if (rec) this.rec = rec;
    this.emit();
  }

  // ---------- the client ----------

  private client(withPin: boolean): OwV2Client {
    if (!this.rec.apiKey) throw new Error('This world has no key.');
    // A ten-digit key (not the demo's) needs the PIN to read a private world too (the SDK's
    // OwKeyKind 'legacy'): without it every read came back 401 and the home said "This key no
    // longer opens the world" (S405, the live write walk on W11). Prefixed keys read without one.
    const key = this.rec.apiKey;
    const readsNeedPin = !isDemoKey(key) && (this.rec.keyKind ?? detectKeyKind(key)) === 'legacy';
    const pin = withPin || readsNeedPin ? pinFor(this.rec) : undefined;
    return new OwV2Client({ apiKey: this.rec.apiKey, apiPin: pin, baseUrl: API_BASE });
  }

  // ---------- pulling ----------

  /**
   * quiet: the poll while the app is open (a reveal reaching a player at the table). It says
   * nothing while it looks, skips the world's name and picture, and redraws only on a change.
   */
  pull(quiet = false): Promise<void> {
    if (this.isLocal || !this.rec.apiKey) return Promise.resolve();
    // A quiet poll before the first full read has nothing to be quiet about: the full read goes.
    this.pulling ??= this.doPull(false, quiet && !!this.rec.cursor).finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async doPull(resynced = false, quiet = false): Promise<void> {
    const before = { status: this.status, text: this.statusText };
    if (!quiet) {
      this.status = 'syncing';
      this.statusText = this.rec.cursor ? 'Checking for changes' : 'Fetching the world';
      this.emit();
    }
    let changed = !quiet;
    // Reads need no PIN (keel checks one if sent, and a wrong one would fail the read).
    const c = this.client(false);
    try {
      if (!quiet) {
        const meta = await c.getWorld();
        const rec = await db.updateWorldRecord(this.id, {
          name: meta.name,
          description: typeof meta.description === 'string' ? meta.description : undefined,
          image_url: typeof meta.image_url === 'string' ? meta.image_url : undefined,
          ...(() => {
            const k = clockFrom(meta as unknown as Record<string, unknown>);
            return { timeNow: k.now, timeUnit: k.unit };
          })(),
        });
        if (rec) this.rec = rec;
      }

      // The quiet poll asks first whether anything moved: keel's head read is an index lookup,
      // no bodies (Skeld, h29 #3511). Compared with the head this phone last APPLIED, so a missed
      // poll never drops a change; a head behind it (a rewind) walks, and the walk's end reads again.
      if (quiet && !resynced && this.rec.appliedHead !== undefined) {
        const tip = await c.changesHead();
        // A guest's view can change with no change in the world (a Character given or taken, a
        // role, the membership gone): keel moves the view's epoch, not the head, and says it beside
        // the head (Skeld h29 #3525). A different one, or one not yet known, walks; a stale view's
        // walk meets resync_required.
        const sameView = this.rec.appliedEpoch !== undefined && tip.epoch === this.rec.appliedEpoch;
        if (String(tip.head) === String(this.rec.appliedHead) && sameView) {
          this.status = 'idle';
          this.statusText = '';
          if (this.status !== before.status || this.statusText !== before.text) {
            this.rebuild();
            this.emit();
          }
          return;
        }
      }

      const gen = c.changesAll(resynced ? undefined : this.rec.cursor);
      let puts: OwElement[] = [];
      let dels: string[] = [];
      let seen = 0;
      // After resync_required the walk goes into a fresh copy, swapped in only when it completes:
      // a walk that fails halfway leaves the old copy standing, not half a world.
      const fresh = resynced ? new Map<string, OwElement>() : null;
      if (fresh) this.settledDuringWalk = new Set();
      const flushBatch = async () => {
        if (fresh) {
          for (const el of puts) fresh.set(el.id, el);
          for (const id of dels) fresh.delete(id);
        } else {
          // A page fetched before a send settled must not put back the older copy.
          puts = puts.filter((el) => this.isNewer(el));
          if (this.retired) throw RETIRED;
          await db.applyElements(this.id, puts, dels);
          if (quiet) for (const el of puts) if (!this.truth.has(el.id)) this.arrived.push(el);
          for (const el of puts) this.truth.set(el.id, el);
          for (const id of dels) this.truth.delete(id);
        }
        puts = [];
        dels = [];
      };
      for (;;) {
        const r = await gen.next();
        if (r.done) {
          // A rewound world (restored from a backup): the walk from a cursor past the head brought
          // nothing and ends at a head behind the one applied, so read it again from zero (keel's word).
          if (!fresh && headBehind(r.value.head, this.rec.appliedHead)) return this.doPull(true);
          await flushBatch();
          if (fresh) {
            // A send that settled while this walk ran is newer than the page that carried its element
            // (the S397 gate). Only those: after a rewind every older copy has the higher change_seq.
            for (const id of this.settledDuringWalk ?? []) {
              const held = this.truth.get(id);
              const page = fresh.get(id);
              if (held && (!page || (held.change_seq ?? 0) >= (page.change_seq ?? 0))) fresh.set(id, held);
            }
            this.settledDuringWalk = null;
            if (this.retired) throw RETIRED;
            await db.clearElements(this.id);
            await db.applyElements(this.id, [...fresh.values()]);
            this.truth = fresh;
          }
          if (this.retired) throw RETIRED;
          const rec2 = await db.updateWorldRecord(this.id, {
            cursor: r.value.cursor,
            appliedHead: r.value.head,
            appliedEpoch: r.value.epoch,
            lastSync: new Date().toISOString(),
            count: this.truth.size,
          });
          if (rec2) this.rec = rec2;
          break;
        }
        const ch = r.value;
        if (ch.op === 'upsert') puts.push({ ...ch.element, type: ch.type, id: ch.id });
        else dels.push(ch.id);
        seen++;
        changed = true;
        if (puts.length + dels.length >= 500) {
          await flushBatch();
          this.statusText = `Fetching the world · ${seen.toLocaleString('en')}`;
          this.emit();
        }
      }
      this.status = 'idle';
      this.keyRefused = false;
      this.statusText = '';
    } catch (e) {
      this.settledDuringWalk = null;
      // Let go mid-walk (the world was opened under another key): it ends here, writing nothing.
      if (e === RETIRED) return;
      if (e instanceof OwApiError && e.isResyncRequired && !resynced) {
        // What this key may see changed: walk from zero and replace the copy (not merge into it).
        return this.doPull(true);
      }
      this.setError(e);
    }
    // A quiet poll that found nothing new and changed no status draws nothing.
    if (!changed && this.status === before.status && this.statusText === before.text) return;
    this.rebuild();
    this.emit();
  }

  /** Elements new to this phone that a quiet poll brought in; the app takes them to say so. */
  arrived: OwElement[] = [];

  /** The last read was refused for the key itself (401/403): the poll stops asking until a full pull. */
  keyRefused = false;

  private setError(e: unknown): void {
    this.keyRefused = e instanceof OwApiError && (e.status === 401 || e.status === 403);
    if (e instanceof OwNetworkError || (e instanceof TypeError && /fetch|network/i.test(e.message))) {
      this.status = 'offline';
      this.statusText = 'No connection: showing what this phone has';
    } else if (e instanceof OwApiError) {
      this.status = 'error';
      this.statusText = e.status === 401 || e.status === 403 ? 'This key no longer opens the world' : e.message;
    } else {
      this.status = 'error';
      this.statusText = e instanceof Error ? e.message : String(e);
    }
  }

  // ---------- writing ----------

  /** The server's copy of an element as this phone last read it (no outbox laid on top). */
  serverCopy(id: string): OwElement | undefined {
    return this.truth.get(id);
  }

  /**
   * An edit: saved to the outbox first, shown at once, sent when it can be. `baseAtOpen` is the
   * server's copy when the user started the edit: a change that arrived since then is a conflict
   * for the 412 rule to judge, never a silent base.
   */
  async edit(id: string, values: Record<string, unknown>, baseAtOpen?: OwElement, photo?: Blob): Promise<void> {
    if (!this.canWrite) throw new Error('This world is read-only here.');
    if (this.isLocal) {
      const cur = this.truth.get(id) ?? ({ id, type: values.type as string, name: '' } as OwElement);
      const next = { ...cur, ...values, updated_at: new Date().toISOString() } as OwElement;
      if (photo) next.image_url = await blobToDataUrl(photo);
      await db.applyElements(this.id, [next]);
      this.truth.set(id, next);
      this.rebuild();
      this.emit();
      return;
    }
    const open = this.outbox.find((r) => r.id === id && r.state === 'waiting');
    if (open) {
      open.values = { ...open.values, ...values };
      // The newest picture wins: a photo replaces a picture set or cleared before it, and the
      // reverse (sent as image_url once the photo is uploaded, send()).
      if (photo) {
        open.photo = photo;
        delete open.values.image_url;
      } else if ('image_url' in values) delete open.photo;
      await db.putOutboxRow(this.id, open);
    } else {
      const el = this.view.get(id);
      if (!el) throw new Error('That element is not on this phone.');
      // A row for this element still in the outbox (being sent, a create not landed, a conflict):
      // this edit follows it, and its base is the server's copy at the moment it is sent.
      const behind = this.outbox.some((r) => r.id === id);
      const base = behind ? undefined : baseAtOpen ?? this.truth.get(id);
      const row: OutboxRow = {
        op: behind || base ? 'patch' : 'create',
        type: el.type,
        id,
        base,
        lateBase: behind || undefined,
        values,
        photo,
        state: 'waiting',
        createdAt: new Date().toISOString(),
      };
      row.seq = await db.putOutboxRow(this.id, row);
      this.outbox.push(row);
    }
    this.rebuild();
    this.emit();
    void this.flush();
  }

  /**
   * A new element, with an id made on the phone so it can be linked to before it is sent. `fixed`:
   * an id and key minted earlier (a sort's plan); an element or a waiting row that already has the
   * id is that create done before, so nothing is made twice.
   */
  async create(type: string, values: Record<string, unknown>, photo?: Blob, fixed?: { id: string; idempotencyKey: string }): Promise<string> {
    if (!this.canWrite) throw new Error('This world is read-only here.');
    if (fixed && (this.truth.has(fixed.id) || this.outbox.some((r) => r.id === fixed.id))) return fixed.id;
    const id = fixed?.id ?? uuid7();
    if (this.isLocal) {
      const now = new Date().toISOString();
      const el = { ...values, id, type, created_at: now, updated_at: now } as OwElement;
      if (photo) el.image_url = await blobToDataUrl(photo);
      await db.applyElements(this.id, [el]);
      this.truth.set(id, el);
      const rec = await db.updateWorldRecord(this.id, { count: this.truth.size });
      if (rec) this.rec = rec;
      this.rebuild();
      this.emit();
      return id;
    }
    return this.queueCreate(type, values, photo, fixed, id);
  }

  /** A create as an outbox row, sent in order when there is signal. */
  private async queueCreate(type: string, values: Record<string, unknown>, photo?: Blob, fixed?: { id: string; idempotencyKey: string }, id = fixed?.id ?? uuid7()): Promise<string> {
    const row: OutboxRow = {
      op: 'create',
      type,
      id,
      values,
      idempotencyKey: fixed?.idempotencyKey ?? uuid7(),
      photo,
      state: 'waiting',
      tried: false,
      createdAt: new Date().toISOString(),
    };
    row.seq = await db.putOutboxRow(this.id, row);
    this.outbox.push(row);
    this.rebuild();
    this.emit();
    void this.flush();
    return id;
  }

  /**
   * Delete an element (the Captain, h37 #4292: anyone who can change the world, after a warning).
   * keel removes the links to it in the same transaction; a world on this phone removes them here.
   * Online it is a row like any change: hidden at once, sent in order behind anything already in
   * flight for it. A catch that never left the phone is simply dropped, and nothing is sent.
   */
  async remove(id: string): Promise<void> {
    if (!this.canWrite) throw new Error('This world is read-only here.');
    const el = this.view.get(id);
    if (!el) return;
    if (this.isLocal) {
      const gone = new Set([id]);
      const now = new Date().toISOString();
      const referrers: OwElement[] = [];
      for (const other of this.truth.values()) {
        const scrubbed = other.id === id ? null : withoutLinksTo(other, gone);
        if (scrubbed) referrers.push({ ...scrubbed, updated_at: now });
      }
      await db.applyElements(this.id, referrers, [id]);
      this.truth.delete(id);
      for (const r of referrers) this.truth.set(r.id, r);
      const rec = await db.updateWorldRecord(this.id, { count: this.truth.size });
      if (rec) this.rec = rec;
      this.rebuild();
      this.emit();
      return;
    }
    if (this.outbox.some((r) => r.id === id && r.op === 'delete')) return;
    const rows = this.outbox.filter((r) => r.id === id);
    const create = rows.find((r) => r.op === 'create');
    // Rows not in flight are moot once it is deleted: let them go. One sending stays, and the delete follows it.
    // Never on keel: a create never tried. (A create keel refused is not on the screen, so it has no
    // Delete; Waiting to send lets it go.)
    const settledFirst = !!create && create.tried === false && create.state === 'waiting';
    for (const r of rows) {
      if (r.state === 'sending') continue;
      if (r === create && !settledFirst) continue; // a create that may have reached keel is sent, then deleted
      await db.settleOutboxRow(this.id, r.seq!, null);
      this.outbox = this.outbox.filter((x) => x !== r);
    }
    if (settledFirst && !this.outbox.some((r) => r.id === id)) {
      // Never left the phone: gone with nothing sent.
      this.rebuild();
      this.emit();
      return;
    }
    const row: OutboxRow = {
      op: 'delete',
      type: el.type,
      id,
      name: typeof el.name === 'string' ? el.name : undefined,
      values: {},
      state: 'waiting',
      createdAt: new Date().toISOString(),
    };
    row.seq = await db.putOutboxRow(this.id, row);
    this.outbox.push(row);
    this.rebuild();
    this.emit();
    void this.flush();
  }

  /** A delete keel answered (or had already done): the element leaves this phone's copy. */
  private async settleDelete(row: OutboxRow): Promise<void> {
    await db.settleOutboxRow(this.id, row.seq!, null);
    this.outbox = this.outbox.filter((r) => r !== row);
    this.deletedHere.add(row.id);
    this.truth.delete(row.id);
    await db.applyElements(this.id, [], [row.id]);
  }

  /**
   * Flushes run one at a time, in a chain. A flush asked for while one runs is never swallowed:
   * it queues one more run after it (and every request until that run starts shares it).
   */
  flush(): Promise<void> {
    if (this.isLocal) return Promise.resolve();
    if (this.queuedFlush) return this.queuedFlush;
    const run = this.flushChain.then(() => {
      this.queuedFlush = null;
      return this.doFlush();
    });
    this.queuedFlush = run;
    this.flushChain = run.catch(() => undefined);
    return run;
  }

  private async doFlush(): Promise<void> {
    if (buildBehind || this.retired) return;
    const rows = this.outbox.filter((r) => r.state === 'waiting').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    if (!rows.length) return;
    if (!pinFor(this.rec)) {
      this.needPin = true;
      this.emit();
      return;
    }
    this.needPin = false;
    const c = this.client(true);
    // Per element, in order: a row waits while an earlier row for the same element is unsettled.
    const blocked = new Set<string>();
    for (const row of [...this.outbox].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      if (buildBehind) break;
      if (row.state !== 'waiting' || blocked.has(row.id)) {
        blocked.add(row.id);
        continue;
      }
      const stop = await this.send(c, row);
      if (stop) break;
      if (this.outbox.includes(row)) blocked.add(row.id);
    }
    this.rebuild();
    this.emit();
  }

  /** Send one row; true when the whole outbox should stop (no network, auth, busy). */
  private async send(c: OwV2Client, row: OutboxRow, attempt = 0): Promise<boolean> {
    if (row.lateBase) {
      const base = this.truth.get(row.id);
      if (!base) return false; // what it follows has not landed: it waits
      row.base = base;
      row.lateBase = undefined;
      await db.putOutboxRow(this.id, row);
    }
    // From here the create may reach keel: a delete can no longer drop it unsent.
    if (row.tried === false) {
      row.tried = true;
      await db.putOutboxRow(this.id, row);
    }
    row.state = 'sending';
    this.emit();
    try {
      if (row.op === 'delete') {
        await c.delete(row.type, row.id);
        await this.settleDelete(row);
        return false;
      }
      if (row.photo) {
        let up: Awaited<ReturnType<OwV2Client['uploadImage']>> | undefined;
        try {
          up = await c.uploadImage(row.photo);
        } catch (e) {
          // A refusal about pictures is about the picture alone: it is set aside with its reason and
          // every other change keeps going (the S398 gate: a full store froze the whole outbox).
          const why = e instanceof OwApiError ? PICTURE_REFUSED[e.code ?? ''] : undefined;
          if (!why) throw e;
          // The picture alone becomes the refused row (tried again on its own, its base taken then);
          // the rest of this row (a caught note, an edit) still goes now.
          const photoRow: OutboxRow = {
            op: 'patch',
            type: row.type,
            id: row.id,
            lateBase: true,
            values: {},
            photo: row.photo,
            state: 'refused',
            error: why,
            createdAt: new Date().toISOString(),
          };
          photoRow.seq = await db.putOutboxRow(this.id, photoRow);
          this.outbox.push(photoRow);
          delete row.photo;
          await db.putOutboxRow(this.id, { ...row, state: 'waiting' });
          if (row.op === 'patch' && !Object.keys(row.values).length) {
            await db.settleOutboxRow(this.id, row.seq!, null);
            this.outbox = this.outbox.filter((r) => r !== row);
            return false;
          }
        }
        if (up) {
          row.values = { ...row.values, image_url: up.url };
          delete row.photo;
          await db.putOutboxRow(this.id, { ...row, state: 'waiting' });
        }
      }
      let el: OwElement;
      if (row.op === 'create') {
        el = await c.create(row.type, { ...row.values, id: row.id }, { idempotencyKey: row.idempotencyKey });
      } else {
        el = await c.patch(row.type, row.id, row.values, { ifMatch: row.base?.change_seq });
      }
      await this.settle(row, el);
      return false;
    } catch (e) {
      return this.onSendError(c, row, e, attempt);
    }
  }

  private async onSendError(c: OwV2Client, row: OutboxRow, e: unknown, attempt: number): Promise<boolean> {
    const keep = async (state: OutboxRow['state'], error?: string) => {
      row.state = state;
      row.error = error;
      await db.putOutboxRow(this.id, row);
    };
    if (e instanceof OwPreconditionFailedError) {
      const current = e.current as OwElement | null;
      if (!current) {
        await keep('gone', 'Deleted elsewhere');
        return false;
      }
      if (Object.keys(row.values).every((f) => sameValue(row.values[f], current[f]))) {
        await this.settle(row, current);
        return false;
      }
      const moved = movedFields(row, current);
      if (!moved.length && attempt < 3) {
        // The element moved, but not on anything this edit touches: send again on the new copy.
        row.base = current;
        await keep('waiting');
        return this.send(c, row, attempt + 1);
      }
      row.current = current;
      await keep('needs-you');
      return false;
    }
    if (e instanceof OwApiError) {
      // Already gone (deleted elsewhere, or this delete landed and its answer was lost): done.
      if (e.status === 404 && row.op === 'delete') {
        await this.settleDelete(row);
        return false;
      }
      if (e.status === 404 && row.op === 'patch') {
        await keep('gone', 'Deleted elsewhere');
        return false;
      }
      if (row.op === 'create' && (e.isIdConflict || e.isIdempotencyConflict) && attempt < 3) {
        // The create reached the server before (its answer was lost). Edits merged into the row
        // since then are not on the server: send them as a patch on the server's copy.
        try {
          const server = { ...(await c.get(row.type, row.id)), type: row.type } as OwElement;
          const differs = Object.keys(row.values).filter((f) => !sameValue(row.values[f], server[f]));
          if (!differs.length) {
            await this.settle(row, server);
            return false;
          }
          if (this.isNewer(server)) {
            this.truth.set(server.id, server);
            await db.applyElements(this.id, [server]);
          }
          row.op = 'patch';
          row.base = server;
          row.values = Object.fromEntries(differs.map((f) => [f, row.values[f]]));
          delete row.idempotencyKey;
          await keep('waiting');
          return this.send(c, row, attempt + 1);
        } catch {
          /* fall through to refused */
        }
      }
      if (e.status === 401 && /^ticket_/.test(e.code ?? '')) {
        // The media edge's ticket expired or was used: a new one on the next try, the PIN is fine.
        await keep('waiting');
        this.retryLater(2000);
        return true;
      }
      if (e.status === 401) {
        // A wrong PIN: stop and ask again; keel throttles wrong PINs, so never loop.
        setPin(this.rec, undefined);
        this.needPin = true;
        await keep('waiting');
        return true;
      }
      if (e.status === 403 && e.code === 'guest_not_supported') {
        // A player's note with no Character of theirs to tell it (keel #241): only the owner can
        // fix that, so this row is refused and the key keeps working (sending again changes nothing).
        await keep('refused', 'You have no Character in this world to tell it. Ask your game master for one.');
        return false;
      }
      if (e.status === 403 && !e.isNotAuthor) {
        await keep('waiting');
        this.status = 'error';
        this.statusText = 'This key can no longer write to the world';
        return true;
      }
      if (e.isBusy || e.status === 429 || e.status >= 500 || (e.status === 409 && e.code === 'upload_pending')) {
        // Busy, throttled (a wrong-PIN throttle included) or a server fault: wait, never refuse.
        await keep('waiting');
        this.retryLater((e.retryAfter ?? (e.status === 429 ? 60 : 10)) * 1000);
        return true;
      }
      if (this.isPlayer && row.op === 'create' && row.type === 'narrative' && (e.status === 400 || e.status === 422)) {
        // keel #241: a group the player's Character is not in answers as a missing link.
        await keep('refused', 'Your Character is not in that group now. Ask your game master.');
        return false;
      }
      await keep('refused', e.isNotAuthor ? 'You can change only what you made in this world' : e.message);
      return false;
    }
    // No network (or a fetch that never answered): wait for the browser to say online.
    await keep('waiting');
    this.status = 'offline';
    this.statusText = 'No connection: your changes wait on this phone';
    return true;
  }

  private retryLater(ms: number): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.flush(), Math.min(Math.max(ms, 1000), 60000));
  }

  /** The conflict screen's answer: per field, mine or theirs. */
  async resolve(row: OutboxRow, keepMine: string[]): Promise<void> {
    const current = row.current;
    if (!current) return;
    const values: Record<string, unknown> = {};
    const moved = new Set(movedFields(row, current));
    for (const f of Object.keys(row.values)) {
      if (!moved.has(f) || keepMine.includes(f)) values[f] = row.values[f];
    }
    if (!Object.keys(values).length) {
      await this.drop(row, current);
      return;
    }
    row.values = values;
    row.base = current;
    row.current = undefined;
    row.state = 'waiting';
    row.error = undefined;
    await db.putOutboxRow(this.id, row);
    if (this.isNewer(current)) {
      this.truth.set(current.id, current);
      await db.applyElements(this.id, [current]);
    }
    this.rebuild();
    this.emit();
    void this.flush();
  }

  /** Drop an edit (take theirs, or let a refused change go). */
  async drop(row: OutboxRow, theirs?: OwElement): Promise<void> {
    const take = theirs && this.isNewer(theirs) ? { ...theirs, type: theirs.type || row.type } : null;
    await db.settleOutboxRow(this.id, row.seq!, take);
    if (take) this.truth.set(take.id, take);
    this.outbox = this.outbox.filter((r) => r !== row);
    this.rebuild();
    this.emit();
  }

  /** Deleted elsewhere: keep my edit as a new element. */
  async keepAsNew(row: OutboxRow): Promise<void> {
    const base = row.base ?? ({} as OwElement);
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...base, ...row.values })) {
      if (['id', 'type', 'change_seq', 'created_at', 'updated_at', 'created_by'].includes(k)) continue;
      if (!isEmptyValue(v)) values[k] = v;
    }
    await this.drop(row);
    this.truth.delete(row.id);
    await db.applyElements(this.id, [], [row.id]);
    await this.create(row.type, values);
  }

  async retryRefused(row: OutboxRow): Promise<void> {
    row.state = 'waiting';
    row.error = undefined;
    await db.putOutboxRow(this.id, row);
    this.rebuild();
    this.emit();
    void this.flush();
  }
}

/** keel's and the media edge's refusals of a picture, said in a sentence; the row can be tried again or let go. */
const PICTURE_REFUSED: Record<string, string> = {
  storage_full: 'Your picture storage is full. Free some on onlyworlds.com, then try again.',
  quota_exceeded: "Today's picture limit for this world is reached. Try again tomorrow.",
  too_large: 'This picture is too large to send.',
};

/** One object URL per queued photo for the life of the page (a photo is a few hundred KB, and few wait). */
const photoUrls = new WeakMap<Blob, string>();
function photoUrl(b: Blob): string {
  let u = photoUrls.get(b);
  if (!u) {
    u = URL.createObjectURL(b);
    photoUrls.set(b, u);
  }
  return u;
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
