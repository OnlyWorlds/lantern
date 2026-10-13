// Inside a world: its home (find, the types), a type's list, an element's page.
import { OwV2Client, type OwElement } from '@onlyworlds/sdk';
import { h, plural } from '../dom';
import { icon, typeIcon } from '../icons';
import { search } from '../search';
import { API_BASE, type WorldSession } from '../world';
import { setPin } from '../pin';
import {
  customEditable,
  customFields,
  fieldInfo,
  fieldLabel,
  isEmptyValue,
  typeColor,
  typeFields,
  typeLabel,
  typePlural,
  TYPES,
} from '../schema';
import { elName, elRow, errorText, sheet, tabbar, toast, topbar, typeChip } from '../ui';
import { clearTonight, tonight, toggleTonight } from '../tonight';
import { addFieldSheet, editField, newElementSheet, pictureSheet } from './edit';
import { fieldsShown } from '../app-state';
import { dateText } from '../time';
import { MAP_TYPES, placesOf, type Place } from '../maps';
import { canGive } from '../party';
import { giveToParty } from './party';

export interface View {
  el: HTMLElement;
  /** Called when the world changes; the view refreshes without touching what the user is typing in. */
  refresh?: () => void;
  /** Called when the screen is left: release what the view holds (a map). */
  destroy?: () => void;
}

// ---------- status lines shared by the world's screens ----------

let behindReload: (() => void) | null = null;
// Kept outside the banner: a redraw while the new build takes over (the poll, a sync) must not
// hand back a live Reload button (the Captain's walk: seconds with no sign the tap took).
let reloading = false;
export function setBehindReload(fn: (() => void) | null): void {
  behindReload = fn;
}

/** Changes wait on a PIN not yet entered (one entered on another of your worlds already counts). */
export const askPin = (s: WorldSession): boolean => s.needPin && !s.pinKnown() && s.waitingCount() > 0;

function statusBanner(s: WorldSession): HTMLElement | null {
  if (behindReload) {
    const b = h('button', { class: 'btn btn-primary', type: 'button' }, reloading ? 'Reloading' : 'Reload') as HTMLButtonElement;
    const text = h('span', null, reloading ? 'Loading the new version.' : 'A new version of Lantern is ready. Changes wait until you reload.');
    const mark = (): void => {
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      b.textContent = 'Reloading';
      text.textContent = 'Loading the new version.';
    };
    if (reloading) mark();
    b.addEventListener('click', () => {
      if (reloading) return;
      reloading = true;
      mark();
      behindReload?.();
    });
    return h('div', { class: 'banner', role: 'status' }, text, b);
  }
  if (askPin(s)) {
    const b = h('button', { class: 'btn btn-primary', type: 'button' }, 'Enter PIN');
    b.addEventListener('click', () => pinSheet(s));
    return h('div', { class: 'banner', role: 'status' }, `Enter your PIN to send ${plural(s.waitingCount(), 'change')}.`, b);
  }
  if (s.status === 'syncing') return h('div', { class: 'banner', role: 'status' }, s.statusText || 'Syncing');
  if (s.status === 'offline' || s.status === 'error') {
    const b = h('button', { class: 'btn', type: 'button' }, 'Try again');
    b.addEventListener('click', () => {
      void s.pull().then(() => s.flush());
    });
    return h('div', { class: 'banner', role: 'status' }, s.statusText, b);
  }
  return null;
}

export function pinSheet(s: WorldSession): void {
  sheet((close) => {
    const pin = h('input', {
      class: 'input',
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'off',
      maxlength: '4',
      'aria-label': 'PIN',
    });
    const err = h('p', { class: 'error', role: 'alert' });
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send my changes');
    const form = h('form', { class: 'stack' }, pin, err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      try {
        // keel checks a PIN sent on a read too: one read proves it before anything is written.
        await new OwV2Client({ apiKey: s.rec.apiKey!, apiPin: pin.value.trim(), baseUrl: API_BASE }).getWorld();
        setPin(s.rec, pin.value.trim());
        s.needPin = false;
        close();
        void s.flush();
      } catch (ex) {
        const m = errorText(ex);
        err.textContent = /PIN|credential|401/i.test(m) ? 'That PIN does not open this world.' : m;
      } finally {
        btn.disabled = false;
      }
    });
    return [
      h('h2', null, 'Your PIN'),
      h(
        'p',
        { class: 'dim', style: 'margin:0' },
        s.rec.role
          ? 'The four digits you set on onlyworlds.com. Lantern keeps it on this phone for all your worlds, until you sign out.'
          : 'The four digits that came with this world\'s key. Lantern keeps it on this phone for this world.',
      ),
      form,
    ];
  }, 'Your PIN');
}

function headPill(s: WorldSession): HTMLElement | null {
  const needs = s.needsYouCount();
  if (needs) return h('a', { class: 'pill alert', href: `#/w/${s.id}/outbox` }, `${needs} need${needs === 1 ? 's' : ''} you`);
  const waiting = s.waitingCount();
  if (askPin(s)) {
    const b = h('button', { class: 'pill alert', type: 'button' }, 'Needs your PIN');
    b.addEventListener('click', () => pinSheet(s));
    return b;
  }
  if (waiting) return h('a', { class: 'pill', href: `#/w/${s.id}/outbox` }, `${waiting} waiting to send`);
  if (s.isLocal) return h('span', { class: 'pill quiet' }, 'On this phone');
  if (s.rec.memberRole === 'guest') return h('span', { class: 'pill quiet' }, 'Player');
  if (!s.canWrite) return h('span', { class: 'pill quiet' }, 'Read only');
  return null;
}

// ---------- home ----------

export function homeView(s: WorldSession): View {
  const head = h('div', { class: 'world-head' });
  const banner = h('div');
  const input = h('input', {
    type: 'search',
    placeholder: 'Search the world',
    'aria-label': 'Search the world',
    autocomplete: 'off',
    autocapitalize: 'off',
    enterkeyhint: 'search',
  });
  const body = h('div', { class: 'stack' });
  let showAll = false;

  const renderBody = () => {
    const q = input.value;
    if (q.trim()) {
      const hits = search(s.view.values(), q);
      body.replaceChildren(
        hits.length
          ? h('div', { class: 'results' }, ...hits.map((x) => elRow(s.id, x.el, x.where === 'description' ? 'in its description' : x.where === 'custom' ? 'in your fields' : undefined)))
          : h('p', { class: 'empty' }, 'Nothing by that name. Try fewer letters.'),
      );
      return;
    }
    if (s.rec.memberRole === 'guest') {
      body.replaceChildren(...playerHome(s));
      return;
    }
    const counts = s.counts();
    // Pins and markers are map furniture, mostly unnamed: they go last, after the world's things.
    const furniture = (t: string) => (t === 'pin' || t === 'marker' ? 1 : 0);
    const present = TYPES.filter((t) => counts.get(t)).sort((a, b) => furniture(a) - furniture(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
    // A world you can write offers every type but the map ones, the empty last: "New" lives on a type's list,
    // so a type with no tile could never get its first element (S397).
    const all = s.canWrite ? [...present, ...TYPES.filter((t) => !counts.get(t) && !MAP_TYPES.has(t))] : present;
    if (!present.length && (!s.canWrite || s.status === 'syncing' || !showAll)) {
      const empty = h(
        'p',
        { class: 'empty' },
        s.status === 'syncing' ? 'Fetching the world…' : s.canWrite ? 'Nothing here yet. Tap Catch to keep the first idea.' : 'This world is empty.',
      );
      const types =
        s.canWrite && s.status !== 'syncing'
          ? (() => {
              const b = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Or choose a type to start with');
              b.addEventListener('click', () => {
                showAll = true;
                renderBody();
              });
              return b;
            })()
          : '';
      body.replaceChildren(empty, h('div', { style: 'text-align:center' }, types));
      return;
    }
    const shown = showAll ? all : present.slice(0, 9);
    const tiles = shown.map((t) =>
      h(
        'a',
        { class: 'type-tile', href: `#/w/${s.id}/t/${t}`, style: `--type:${typeColor(t)}` },
        // The name keeps the tile's whole width; the type's mark sits with the count under it.
        h('b', null, typePlural(t)),
        h('span', { class: 'tile-count' }, typeIcon(t, 16), (counts.get(t) ?? 0).toLocaleString('en')),
      ),
    );
    const more =
      all.length > 9
        ? (() => {
            const b = h('button', { class: 'btn btn-quiet', type: 'button' }, showAll ? 'Fewer types' : `All ${all.length} types`);
            b.addEventListener('click', () => {
              showAll = !showAll;
              renderBody();
            });
            return b;
          })()
        : null;
    const unsorted = s.elements().filter((e) => e.type === 'narrative' && e.supertype === 'Unsorted');
    // Tonight's cast first: the session's handful, in the order kept; one gone from the world drops out.
    const cast = tonight(s.id)
      .map((id) => s.get(id))
      .filter((e): e is OwElement => !!e);
    const clear = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'clear-tonight', style: 'align-self:flex-start' }, 'Clear the list');
    clear.addEventListener('click', () => {
      clearTonight(s.id);
      renderBody();
    });
    body.replaceChildren(
      ...(cast.length
        ? [h('p', { class: 'section-label' }, 'Tonight'), h('div', { class: 'results', 'data-part': 'tonight' }, ...cast.map((e) => elRow(s.id, e))), clear]
        : []),
      unsorted.length
        ? h(
            'a',
            { class: 'choice', href: `#/w/${s.id}/t/narrative?unsorted` },
            h('b', null, `Unsorted · ${unsorted.length}`),
            h('span', null, 'Caught and not yet turned into elements'),
          )
        : '',
      // Before now (src/views/time.ts): only once the world has an Event to put in order.
      (counts.get('event') ?? 0) > 0
        ? h(
            'a',
            { class: 'choice', href: `#/w/${s.id}/time`, 'data-action': 'before-now' },
            h('b', null, 'Before now'),
            h('span', null, s.rec.timeNow === undefined ? 'The Events in the order they happened' : `The Events in order, up to ${dateText(s.rec.timeNow, s.rec.timeUnit)}`),
          )
        : '',
      h('p', { class: 'section-label' }, 'In this world'),
      h('div', { class: 'type-grid' }, ...tiles),
      more ?? '',
    );
  };

  const refresh = () => {
    head.replaceChildren(
      h(
        'a',
        { class: 'world-name', href: '#/worlds', 'aria-label': `${s.rec.name}, your worlds` },
        h('span', null, s.rec.name || 'Unnamed world'),
        icon('down', 20),
      ),
      headPill(s) ?? '',
    );
    banner.replaceChildren(statusBanner(s) ?? '');
    renderBody();
  };

  let t: number | undefined;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(renderBody, 80);
  });

  refresh();
  const el = h(
    'main',
    { class: 'screen has-tabbar', 'data-screen': 'home' },
    head,
    banner,
    h('label', { class: 'search' }, icon('search', 20), input),
    body,
    tabbar(s, 'world'),
  );
  return { el, refresh };
}

// ---------- a type's list ----------

export function typeView(s: WorldSession, type: string, onlyUnsorted: boolean): View {
  const input = h('input', {
    type: 'search',
    placeholder: `Search ${typePlural(type).toLowerCase()}`,
    'aria-label': `Search ${typePlural(type).toLowerCase()}`,
    autocomplete: 'off',
  });
  const list = h('div', { class: 'results' });
  const count = h('p', { class: 'muted small', style: 'margin:0' });
  const banner = h('div');
  const refresh = () => {
    banner.replaceChildren(statusBanner(s) ?? '');
    let els = s.ofType(type);
    if (onlyUnsorted) els = els.filter((e) => e.supertype === 'Unsorted');
    const q = input.value.trim();
    const shown = q ? search(els, q, 500).map((x) => x.el) : els;
    count.textContent = q ? `${shown.length} of ${els.length}` : plural(els.length, typeLabel(type).toLowerCase());
    list.replaceChildren(...shown.slice(0, 400).map((e) => elRow(s.id, e)));
    if (shown.length > 400) list.appendChild(h('p', { class: 'muted small' }, `Showing 400 of ${shown.length}. Search to narrow it.`));
  };
  input.addEventListener('input', refresh);
  // Unsorted: the notes can be sorted into the world (the morning after, src/views/sort.ts).
  const add = onlyUnsorted
    ? s.canWrite
      ? h('a', { class: 'btn btn-pill', href: `#/w/${s.id}/sort`, 'data-action': 'sort' }, icon('spark', 16), 'Sort')
      : null
    : s.canWrite && !MAP_TYPES.has(type)
    ? (() => {
        const b = h('button', { class: 'btn btn-pill', type: 'button' }, icon('plus', 16), `New`);
        b.addEventListener('click', () => newElementSheet(s, type));
        return b;
      })()
    : null;
  refresh();
  return {
    el: h(
      'main',
      { class: 'screen has-tabbar', 'data-screen': 'type' },
      topbar(onlyUnsorted ? 'Unsorted' : typePlural(type), `#/w/${s.id}`, ...(add ? [add] : [])),
      banner,
      h('label', { class: 'search' }, icon('search', 20), input),
      count,
      list,
      tabbar(s, null),
    ),
    refresh,
  };
}

// ---------- an element's page ----------

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

function linkChip(s: WorldSession, id: string): HTMLElement {
  const t = s.get(id);
  if (!t) return h('span', { class: 'link-chip missing' }, 'Not on this phone');
  return h('a', { class: 'link-chip', href: `#/w/${s.id}/e/${id}`, style: `--type:${typeColor(t.type)}` }, elName(t));
}

function valueNode(s: WorldSession, type: string, field: string, v: unknown): Node {
  const info = fieldInfo(type, field);
  if (info?.type === 'single_link' && typeof v === 'string') return h('div', { class: 'chips' }, linkChip(s, v));
  if (info?.type === 'multi_link' && Array.isArray(v)) return h('div', { class: 'chips' }, ...v.map((id) => linkChip(s, String(id))));
  if (info?.type === 'integer_max' && info.max) return document.createTextNode(`${v} / ${info.max}`);
  return document.createTextNode(String(v));
}

/** `fill`: just made from Catch, so its empty fields show at once, ready to fill in (the Captain, h37 #3555). */
export function elementView(s: WorldSession, id: string, fill = false): View {
  const main = h('main', { class: 'screen has-tabbar', 'data-screen': 'element' });
  // All fields (Settings) opens with the empty ones showing, as a page just made from Catch does.
  let showEmpty = fill || fieldsShown() === 'all';
  let showAllBacklinks = false;

  const refresh = () => {
    const el = s.get(id);
    const back = h('a', { class: 'btn btn-round', href: `#/w/${s.id}`, 'aria-label': 'Back', style: 'border:0;background:transparent' }, icon('back', 24));
    back.addEventListener('click', (e) => {
      if (history.length > 1) {
        e.preventDefault();
        history.back();
      }
    });
    if (!el) {
      main.replaceChildren(
        h('div', { class: 'topbar' }, back),
        h('p', { class: 'empty' }, s.status === 'syncing' ? 'Fetching…' : 'This element is not on this phone.'),
        tabbar(s, null),
      );
      return;
    }
    const pending = s.pending(id);
    const editable = s.canWrite;
    // An element not yet made on keel is said once, at its name; per-field marks are for edits (S397).
    const create = pending.get('*');
    const wait = (f: string) => {
      const row = pending.get(f) ?? (f === 'name' ? create : undefined);
      if (!row || (row === create && f !== 'name')) return null;
      // Waiting on the PIN: the mark says so and asks for it (the Captain's walk: a picture sat
      // "waiting to send" with nothing saying why).
      if (row.state === 'waiting' && askPin(s)) {
        const b = h('button', { class: 'wait wait-pin', type: 'button' }, 'needs your PIN');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          pinSheet(s);
        });
        return b;
      }
      const label = row.state === 'needs-you' || row.state === 'gone' ? 'needs you' : row.state === 'refused' ? 'not sent' : 'waiting to send';
      return h('span', { class: 'wait' }, label);
    };
    const tapRow = (f: string, row: HTMLElement) => {
      if (!editable) return row;
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        editField(s, el, f);
      });
      row.style.cursor = 'pointer';
      return row;
    };
    // A linked field's chips open what they name, so changing the links has its own pencil
    // (the Captain's walk: the only way in was the empty space beside the chips).
    const pencil = (f: string) => {
      if (!editable) return null;
      const b = h('button', { class: 'edit-btn', type: 'button', 'aria-label': `Change ${fieldLabel(f).toLowerCase()}` }, icon('edit', 18));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        editField(s, el, f);
      });
      return b;
    };

    const hasPicture = typeof el.image_url === 'string' && SHOWN_PICTURE.test(el.image_url);
    // No picture yet: the placeholder itself opens Camera or Gallery (the Captain, #3660).
    const tapToAdd = !hasPicture && editable && !MAP_TYPES.has(el.type);
    const avatar = tapToAdd
      ? h('button', { class: 'avatar avatar-add', type: 'button', style: `--type:${typeColor(el.type)}`, 'aria-label': 'Add a picture', 'data-action': 'avatar-picture' })
      : h('div', { class: 'avatar', style: `--type:${typeColor(el.type)}`, 'aria-hidden': 'true' });
    if (hasPicture) avatar.style.backgroundImage = `url("${el.image_url}")`;
    else avatar.append(initials(elName(el)));
    // The camera hangs off the corner, beside the square rather than inside it, so it never covers the initials.
    const avatarBox = tapToAdd
      ? h('div', { class: 'avatar-box' }, avatar, h('span', { class: 'avatar-cam', 'aria-hidden': 'true' }, icon('camera', 14, 2.2)))
      : avatar;
    if (tapToAdd) avatar.addEventListener('click', () => pictureSheet(s, el, false));

    const kind = [typeLabel(el.type), el.supertype, el.subtype].filter(Boolean).join(' · ');
    // A caught line can be a sentence long: the title steps down so it does not fill the screen.
    const len = [...elName(el)].length;
    const nameH = h('h1', { style: len > 44 ? 'font-size:1.2rem' : len > 26 ? 'font-size:1.4rem' : null }, elName(el), wait('name'));
    const headText = h('div', { class: 'stack', style: 'gap:4px;min-width:0' }, nameH, h('span', { class: 'muted' }, kind));
    if (editable) {
      headText.style.cursor = 'pointer';
      headText.addEventListener('click', () => editField(s, el, 'name'));
    }

    const desc = typeof el.description === 'string' && el.description.trim() ? el.description : '';
    const descNode = desc
      ? tapRow('description', h('p', { class: 'prose' }, desc, wait('description')))
      : null;

    const shown = fieldsShown();
    const rows: HTMLElement[] = [];
    const empty: string[] = [];
    // The head already says the kind; the rows are only there to tap and change it.
    for (const f of editable ? ['supertype', 'subtype'] : []) {
      const v = el[f];
      if (isEmptyValue(v)) empty.push(f);
      else rows.push(tapRow(f, h('div', { class: 'frow' }, h('span', { class: 'k' }, fieldLabel(f), wait(f)), h('span', { class: 'v' }, String(v)))));
    }
    for (const { field, info } of typeFields(el.type)) {
      const v = el[field];
      if (isEmptyValue(v)) {
        empty.push(field);
        continue;
      }
      // A single link takes the multi link's layout: label, its marks and the pencil on one line, the chip under it (the Captain's walk, #3660).
      const isBlock = info.type === 'multi_link' || info.type === 'single_link' || (info.type === 'text' && String(v).length > 28);
      const isLink = info.type === 'single_link' || info.type === 'multi_link';
      rows.push(
        tapRow(
          field,
          h(
            'div',
            { class: `frow${isBlock ? ' block' : ''}`, 'data-field': field },
            h('span', { class: 'k' }, fieldLabel(field), wait(field), isLink ? pencil(field) : null),
            h('span', { class: 'v' }, valueNode(s, el.type, field, v)),
          ),
        ),
      );
    }
    // The world maker's own fields (Atlas's custom fields, x_mood), after the schema's, under their own label.
    // A list or a group of values reads here and is changed in Atlas; an empty one waits with the empty rows.
    const customRows: HTMLElement[] = [];
    const customEmpty: string[] = [];
    for (const field of customFields(el)) {
      const v = el[field];
      if (isEmptyValue(v)) {
        if (customEditable(v)) customEmpty.push(field);
        continue;
      }
      const text = Array.isArray(v)
        ? v.map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : '…')).join(', ')
        : typeof v === 'boolean'
          ? v ? 'Yes' : 'No'
          : typeof v === 'object'
            ? 'Set in Atlas'
            : String(v);
      const isBlock = text.length > 28;
      const row = h(
        'div',
        { class: `frow${isBlock ? ' block' : ''}`, 'data-field': field },
        h('span', { class: 'k' }, fieldLabel(field), wait(field)),
        h('span', { class: `v${typeof v === 'object' && !Array.isArray(v) ? ' muted' : ''}` }, text),
      );
      customRows.push(customEditable(v) ? tapRow(field, row) : row);
    }
    // Before the empty rows are built: a description is an empty field too (the S398 gate).
    if (!desc && editable) empty.unshift('description');
    const dot = (f: string) => tapRow(f, h('div', { class: 'frow', 'data-field': f }, h('span', { class: 'k' }, fieldLabel(f)), h('span', { class: 'v muted' }, '·')));
    // The phone's choice (Settings, h37 #4061). Only your own: the type's fields, filled or not, wait
    // behind the toggle and your empty ones show. Otherwise the toggle holds every empty field.
    const own = shown === 'own';
    if (own || showEmpty) customRows.push(...customEmpty.map(dot));
    const schemaRows = own && !showEmpty ? [] : [...rows, ...(showEmpty ? empty.map(dot) : [])];
    const behindToggle = own ? rows.length + empty.length : empty.length + customEmpty.length;

    // Grouped by type, then by name: the store's order differs between a fresh read and a reopen,
    // and the first eight shown must not change with it (S397).
    const links = [...s.backlinks(id)].sort((a, b) => {
      const ea = s.get(a);
      const eb = s.get(b);
      return (ea?.type ?? '').localeCompare(eb?.type ?? '') || elName(ea).localeCompare(elName(eb)) || (a < b ? -1 : a > b ? 1 : 0);
    });
    let backNode: HTMLElement | null = null;
    if (links.length) {
      const shown = showAllBacklinks ? links : links.slice(0, 8);
      const chips = shown.map((lid) => {
        const t = s.get(lid);
        return h('a', { class: 'link-chip plain', href: `#/w/${s.id}/e/${lid}` }, t ? typeChip(t.type) : '', elName(t));
      });
      const more =
        links.length > 8 && !showAllBacklinks
          ? (() => {
              const b = h('button', { class: 'link-chip missing', type: 'button' }, `+${links.length - 8}`);
              b.addEventListener('click', () => {
                showAllBacklinks = true;
                refresh();
              });
              return b;
            })()
          : null;
      backNode = h('div', { class: 'frow block' }, h('span', { class: 'k' }, 'Linked from'), h('div', { class: 'chips' }, ...chips, more));
    }

    const toggle =
      behindToggle > 0
        ? (() => {
            const label = own
              ? showEmpty
                ? `Hide the ${typeLabel(el.type)}'s fields`
                : `Show the ${typeLabel(el.type)}'s ${behindToggle} fields`
              : showEmpty
                ? 'Hide the empty fields'
                : `Show the ${behindToggle} empty fields`;
            const b = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'toggle-fields' }, label);
            b.addEventListener('click', () => {
              showEmpty = !showEmpty;
              refresh();
            });
            return b;
          })()
        : null;
    const addField = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'add-field' }, 'Add a field');
    addField.addEventListener('click', () => addFieldSheet(s, el));
    const needs = [...pending.values()].find((r) => r.state === 'needs-you' || r.state === 'gone' || r.state === 'refused');

    main.replaceChildren(
      h('div', { class: 'topbar' }, back, h('div', { class: 'actions' })),
      needs
        ? h(
            'a',
            { class: 'banner', href: `#/w/${s.id}/outbox`, style: 'text-decoration:none' },
            needs.state === 'refused' ? 'A change to this was not sent. Tap to see why.' : 'A change to this needs you. Tap to choose.',
          )
        : '',
      h('div', { class: 'el-head' }, avatarBox, headText),
      actionRow(s, el, wait('image_url')),
      picture(el),
      descNode ?? '',
      ...(customRows.length
        ? [
            schemaRows.length ? h('div', { class: 'fields' }, ...schemaRows) : '',
            h('p', { class: 'section-label', style: 'margin:8px 0 0' }, 'Your fields'),
            h('div', { class: 'fields', 'data-section': 'custom' }, ...customRows),
            // The custom list's last row already draws the line above it.
            backNode ? h('div', { class: 'fields', style: 'border-top:0' }, backNode) : '',
          ]
        : [h('div', { class: 'fields' }, ...schemaRows, backNode ?? '')]),
      toggle ?? '',
      editable ? addField : '',
      editable ? h('p', { class: 'muted small', style: 'margin:0' }, 'Tap a value to change it.') : '',
      tabbar(s, null),
    );
  };
  refresh();
  return { el: main, refresh };
}

/**
 * A player's home (a guest, Keel #213): the world as their Character knows it is small, so it is
 * one list, newest first at the top, where what the game master gives the party appears.
 */
function playerHome(s: WorldSession): (Node | string)[] {
  // Pins and markers are map furniture, mostly unnamed: not what a player reads.
  const els = s.elements().filter((e) => e.type !== 'pin' && e.type !== 'marker');
  const stamp = (e: { updated_at?: string; created_at?: string }) => e.updated_at ?? e.created_at ?? '';
  const newest = [...els].sort((a, b) => stamp(b).localeCompare(stamp(a))).slice(0, 3);
  const all = [...els].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  // Named by name, never a pronoun: the player chose who their Character is.
  const me = s.rec.characterId ? s.get(s.rec.characterId) : undefined;
  const intro = me
    ? h('p', { class: 'dim', style: 'margin:0' }, 'You play ', h('a', { href: `#/w/${s.id}/e/${me.id}` }, elName(me)), `. You see what ${elName(me)} knows.`)
    : h('p', { class: 'dim', style: 'margin:0' }, 'You are a player here. You see what your Character knows.');
  return [
    intro,
    els.length
      ? h('div', { class: 'stack' }, h('p', { class: 'section-label' }, 'Newest'), h('div', { class: 'results' }, ...newest.map((e) => elRow(s.id, e))))
      : h('p', { class: 'empty' }, s.status === 'syncing' ? 'Fetching what you know…' : 'Nothing yet. What your game master gives you appears here.'),
    els.length > 3
      ? h(
          'div',
          { class: 'stack' },
          h('p', { class: 'section-label' }, `What you know · ${els.length}`),
          h('div', { class: 'results' }, ...all.slice(0, 300).map((e) => elRow(s.id, e))),
        )
      : '',
  ];
}

export function mapHref(worldId: string, p: Place): string {
  const q = p.pin ? `?pin=${p.pin}` : p.marker ? `?marker=${p.marker}` : p.zone ? `?zone=${p.zone}` : '';
  return `#/w/${worldId}/map/${p.map}${q}`;
}

/**
 * The element's actions, one row: "Show on map", one per map it is on (only maps with a picture
 * online), and "Give it to the party", a game master's tap on a thing the party found (not on a
 * phone-only world: it has no players).
 */
function actionRow(s: WorldSession, el: OwElement, pictureWait: HTMLElement | null): HTMLElement | '' {
  const places = placesOf(s, el);
  const label = (p: Place) =>
    el.type === 'map' ? 'Open the map' : places.length > 1 ? `On ${elName(s.get(p.map))}` : 'Show on map';
  const acts: (HTMLElement | null)[] = places.map((p) => h('a', { class: 'btn btn-pill', href: mapHref(s.id, p) }, icon('map', 16), label(p)));
  // Tonight's cast (src/tonight.ts): this phone's own list, so a reader and a player keep one too.
  const kept = tonight(s.id).includes(el.id);
  const keepBtn = h(
    'button',
    { class: 'btn btn-pill', type: 'button', 'data-action': 'tonight', 'aria-pressed': String(kept) },
    icon(kept ? 'check' : 'pin', 16),
    kept ? 'Kept for tonight' : 'Keep for tonight',
  );
  keepBtn.addEventListener('click', () => {
    if (!toggleTonight(s.id, el.id)) toast('This phone would not keep the list.');
    s.touch();
  });
  acts.push(keepBtn);
  if (s.canWrite && !s.isLocal && s.rec.memberRole !== 'guest' && canGive(el.type)) {
    const b = h('button', { class: 'btn btn-pill', type: 'button' }, icon('reveal', 16), 'Give it to the party');
    b.addEventListener('click', () => giveToParty(s, el));
    acts.push(b);
  }
  // A picture any time after the element is made (the Captain's walk). A map's picture is its
  // map, set where the map is drawn (Atlas), not here.
  if (s.canWrite && !MAP_TYPES.has(el.type)) {
    const has = typeof el.image_url === 'string' && SHOWN_PICTURE.test(el.image_url);
    const b = h('button', { class: 'btn btn-pill', type: 'button', 'data-action': 'picture' }, icon('image', 16), has ? 'Change the picture' : 'Add a picture');
    b.addEventListener('click', () => pictureSheet(s, el, has));
    acts.push(b, pictureWait);
  }
  return acts.some(Boolean) ? h('div', { class: 'chips map-links' }, ...acts) : '';
}

/** What the page shows as a picture: online, held in a local world, or a photo waiting to send. */
const SHOWN_PICTURE = /^(https:|data:image\/|blob:)/;

/** An element's picture, large: a photographed page has to be readable. Tap opens it whole. */
function picture(el: { image_url?: unknown; name?: string }): HTMLElement | '' {
  const src = typeof el.image_url === 'string' && SHOWN_PICTURE.test(el.image_url) ? el.image_url : '';
  if (!src) return '';
  const img = h('img', { class: 'picture', src, alt: el.name ? `The picture of ${el.name}` : 'The picture', loading: 'lazy' });
  if (src.startsWith('https:')) return h('a', { href: src, target: '_blank', rel: 'noopener' }, img);
  return img;
}

export function notFound(text: string, back = '#/'): HTMLElement {
  return h('main', { class: 'screen' }, topbar('Not here', back), h('p', { class: 'empty' }, text));
}
