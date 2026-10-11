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
} from '@onlyworlds/sdk';
import * as db from './db';
import type { OutboxRow, WorldRecord } from './db';
import { uuid7 } from './uuid7';
import { isEmptyValue } from './schema';

export const API_BASE = 'https://www.onlyworlds.com/api/v2';

/** The PIN is asked once and kept for the session (DESIGN: Keys and sign-in), never stored. */
function sessionPin(worldId: string): string | undefined {
  try {
    return sessionStorage.getItem(`lantern-pin-${worldId}`) ?? undefined;
  } catch {
    return undefined;
  }
}
export function setSessionPin(worldId: string, pin: string | undefined): void {
  try {
    if (pin) sessionStorage.setItem(`lantern-pin-${worldId}`, pin);
    else sessionStorage.removeItem(`lantern-pin-${worldId}`);
  } catch {
    /* private mode: the PIN is asked again next time */
  }
}

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
  const base = row.base ?? {};
  return Object.keys(row.values).filter((f) => !sameValue((base as Record<string, unknown>)[f], current[f]));
}

const sessions = new Map<string, Promise<WorldSession>>();

export function openWorld(id: string): Promise<WorldSession> {
  let p = sessions.get(id);
  if (!p) {
    p = WorldSession.load(id);
    sessions.set(id, p);
    p.catch(() => sessions.delete(id));
  }
  return p;
}

export function forgetSession(id: string): void {
  sessions.delete(id);
}

export class WorldSession {
  rec: WorldRecord;
  /** The server's truth (or, for a world on this phone only, the only truth). */
  private truth = new Map<string, OwElement>();
  outbox: OutboxRow[] = [];
  /** What the screen shows: truth with the outbox laid on top. */
  view = new Map<string, OwElement>();
  status: SyncStatus = 'idle';
  statusText = '';
  needPin = false;
  private listeners = new Set<() => void>();
  private backlinkCache: Map<string, string[]> | null = null;
  private lookupCache: OwWorldIndex<OwElement> | null = null;
  private pulling: Promise<void> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private queuedFlush: Promise<void> | null = null;
  private retryTimer: number | undefined;

  private constructor(rec: WorldRecord) {
    this.rec = rec;
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
    if (this.isLocal) return true;
    if (this.rec.kind === 'demo' || !this.rec.apiKey || isDemoKey(this.rec.apiKey)) return false;
    return kindCanWrite(this.rec.keyKind ?? detectKeyKind(this.rec.apiKey));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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
    for (const row of [...this.outbox].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      if (row.state === 'refused') continue;
      const cur = this.view.get(row.id) ?? ({ id: row.id, type: row.type, name: '' } as OwElement);
      this.view.set(row.id, { ...cur, ...row.values, type: row.type, id: row.id });
    }
    this.backlinkCache = null;
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
      if (row.op === 'create') m.set('*', row);
    }
    return m;
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

  // ---------- the client ----------

  private client(withPin: boolean): OwV2Client {
    if (!this.rec.apiKey) throw new Error('This world has no key.');
    const pin = withPin ? sessionPin(this.id) : undefined;
    return new OwV2Client({ apiKey: this.rec.apiKey, apiPin: pin, baseUrl: API_BASE });
  }

  // ---------- pulling ----------

  pull(): Promise<void> {
    if (this.isLocal || !this.rec.apiKey) return Promise.resolve();
    this.pulling ??= this.doPull().finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async doPull(resynced = false): Promise<void> {
    this.status = 'syncing';
    this.statusText = this.rec.cursor ? 'Checking for changes' : 'Fetching the world';
    this.emit();
    // Reads need no PIN (keel checks one if sent, and a wrong one would fail the read).
    const c = this.client(false);
    try {
      const meta = await c.getWorld();
      const rec = await db.updateWorldRecord(this.id, {
        name: meta.name,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        image_url: typeof meta.image_url === 'string' ? meta.image_url : undefined,
      });
      if (rec) this.rec = rec;

      const gen = c.changesAll(this.rec.cursor);
      let puts: OwElement[] = [];
      let dels: string[] = [];
      let seen = 0;
      const flushBatch = async () => {
        await db.applyElements(this.id, puts, dels);
        for (const el of puts) this.truth.set(el.id, el);
        for (const id of dels) this.truth.delete(id);
        puts = [];
        dels = [];
      };
      for (;;) {
        const r = await gen.next();
        if (r.done) {
          await flushBatch();
          const rec2 = await db.updateWorldRecord(this.id, {
            cursor: r.value.cursor,
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
        if (puts.length + dels.length >= 500) {
          await flushBatch();
          this.statusText = `Fetching the world · ${seen.toLocaleString('en')}`;
          this.emit();
        }
      }
      this.status = 'idle';
      this.statusText = '';
    } catch (e) {
      if (e instanceof OwApiError && e.isResyncRequired && !resynced) {
        // What this key may see changed: drop the cursor and the copy, walk from zero.
        await db.clearElements(this.id);
        this.truth.clear();
        const rec = await db.updateWorldRecord(this.id, { cursor: undefined });
        if (rec) this.rec = rec;
        return this.doPull(true);
      }
      this.setError(e);
    }
    this.rebuild();
    this.emit();
  }

  private setError(e: unknown): void {
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

  /** An edit: saved to the outbox first, shown at once, sent when it can be. */
  async edit(id: string, values: Record<string, unknown>): Promise<void> {
    if (!this.canWrite) throw new Error('This world is read-only here.');
    if (this.isLocal) {
      const cur = this.truth.get(id) ?? ({ id, type: values.type as string, name: '' } as OwElement);
      const next = { ...cur, ...values, updated_at: new Date().toISOString() } as OwElement;
      await db.applyElements(this.id, [next]);
      this.truth.set(id, next);
      this.rebuild();
      this.emit();
      return;
    }
    const open = this.outbox.find((r) => r.id === id && r.state === 'waiting');
    if (open) {
      open.values = { ...open.values, ...values };
      await db.putOutboxRow(this.id, open);
    } else {
      const base = this.truth.get(id);
      const el = this.view.get(id);
      if (!el) throw new Error('That element is not on this phone.');
      const row: OutboxRow = {
        op: base ? 'patch' : 'create',
        type: el.type,
        id,
        base,
        values,
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

  /** A new element, with an id made on the phone so it can be linked to before it is sent. */
  async create(type: string, values: Record<string, unknown>, photo?: Blob): Promise<string> {
    if (!this.canWrite) throw new Error('This world is read-only here.');
    const id = uuid7();
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
    const row: OutboxRow = {
      op: 'create',
      type,
      id,
      values,
      idempotencyKey: uuid7(),
      photo,
      state: 'waiting',
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
    if (buildBehind) return;
    const rows = this.outbox.filter((r) => r.state === 'waiting').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    if (!rows.length) return;
    if (!sessionPin(this.id)) {
      this.needPin = true;
      this.emit();
      return;
    }
    this.needPin = false;
    const c = this.client(true);
    for (const row of rows) {
      if (buildBehind) break;
      const stop = await this.send(c, row);
      if (stop) break;
    }
    this.rebuild();
    this.emit();
  }

  /** Send one row; true when the whole outbox should stop (no network, auth, busy). */
  private async send(c: OwV2Client, row: OutboxRow, attempt = 0): Promise<boolean> {
    row.state = 'sending';
    this.emit();
    try {
      if (row.photo) {
        const up = await c.uploadImage(row.photo);
        row.values = { ...row.values, image_url: up.url };
        delete row.photo;
        await db.putOutboxRow(this.id, { ...row, state: 'waiting' });
      }
      let el: OwElement;
      if (row.op === 'create') {
        el = await c.create(row.type, { ...row.values, id: row.id }, { idempotencyKey: row.idempotencyKey });
      } else {
        el = await c.patch(row.type, row.id, row.values, { ifMatch: row.base?.change_seq });
      }
      el = { ...el, type: el.type || row.type };
      await db.settleOutboxRow(this.id, row.seq!, el);
      this.outbox = this.outbox.filter((r) => r !== row);
      this.truth.set(el.id, el);
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
      if (e.status === 404 && row.op === 'patch') {
        await keep('gone', 'Deleted elsewhere');
        return false;
      }
      if (e.isIdConflict && row.op === 'create') {
        // The create reached the server before (its answer was lost): take the server's copy.
        try {
          const el = await c.get(row.type, row.id);
          await db.settleOutboxRow(this.id, row.seq!, el);
          this.outbox = this.outbox.filter((r) => r !== row);
          this.truth.set(el.id, el);
          return false;
        } catch {
          /* fall through to refused */
        }
      }
      if (e.status === 401) {
        // A wrong PIN: stop and ask again; keel throttles wrong PINs, so never loop.
        setSessionPin(this.id, undefined);
        this.needPin = true;
        await keep('waiting');
        return true;
      }
      if (e.status === 403 && !e.isNotAuthor) {
        await keep('waiting');
        this.status = 'error';
        this.statusText = 'This key can no longer write to the world';
        return true;
      }
      if (e.isBusy || (e.status === 409 && e.code === 'upload_pending')) {
        await keep('waiting');
        this.retryLater((e.retryAfter ?? 5) * 1000);
        return true;
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
    for (const f of Object.keys(row.values)) {
      const moved = !sameValue((row.base as Record<string, unknown> | undefined)?.[f], current[f]);
      if (!moved || keepMine.includes(f)) values[f] = row.values[f];
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
    this.truth.set(current.id, current);
    await db.applyElements(this.id, [current]);
    this.rebuild();
    this.emit();
    void this.flush();
  }

  /** Drop an edit (take theirs, or let a refused change go). */
  async drop(row: OutboxRow, theirs?: OwElement): Promise<void> {
    await db.settleOutboxRow(this.id, row.seq!, theirs ?? null);
    if (theirs) this.truth.set(theirs.id, theirs);
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

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
