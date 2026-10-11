// Inside a world: its home (find, the types), a type's list, an element's page.
import { OwV2Client } from '@onlyworlds/sdk';
import { h, plural } from '../dom';
import { icon } from '../icons';
import { search } from '../search';
import { API_BASE, setSessionPin, type WorldSession } from '../world';
import {
  fieldInfo,
  fieldLabel,
  isEmptyValue,
  typeColor,
  typeFields,
  typeLabel,
  typePlural,
  TYPES,
} from '../schema';
import { elName, elRow, errorText, sheet, topbar, typeChip } from '../ui';
import { editField, newElementSheet } from './edit';

export interface View {
  el: HTMLElement;
  /** Called when the world changes; the view refreshes without touching what the user is typing in. */
  refresh?: () => void;
}

// ---------- status lines shared by the world's screens ----------

let behindReload: (() => void) | null = null;
export function setBehindReload(fn: (() => void) | null): void {
  behindReload = fn;
}

function statusBanner(s: WorldSession): HTMLElement | null {
  if (behindReload) {
    const b = h('button', { class: 'btn btn-primary', type: 'button' }, 'Reload');
    b.addEventListener('click', () => behindReload?.());
    return h('div', { class: 'banner', role: 'status' }, 'A new version of Lantern is ready. Changes wait until you reload.', b);
  }
  if (s.needPin && s.waitingCount()) {
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
        setSessionPin(s.id, pin.value.trim());
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
      h('p', { class: 'dim', style: 'margin:0' }, 'The four digits you set on onlyworlds.com. Lantern keeps it until you close the app.'),
      form,
    ];
  }, 'Your PIN');
}

function headPill(s: WorldSession): HTMLElement | null {
  const needs = s.needsYouCount();
  if (needs) return h('a', { class: 'pill alert', href: `#/w/${s.id}/outbox` }, `${needs} need${needs === 1 ? 's' : ''} you`);
  const waiting = s.waitingCount();
  if (waiting) return h('a', { class: 'pill', href: `#/w/${s.id}/outbox` }, `${waiting} waiting to send`);
  if (!s.canWrite && !s.isLocal) return h('span', { class: 'pill quiet' }, 'Read only');
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
          ? h('div', { class: 'results' }, ...hits.map((x) => elRow(s.id, x.el, x.where === 'description' ? 'in its description' : undefined)))
          : h('p', { class: 'empty' }, 'Nothing by that name. Try fewer letters.'),
      );
      return;
    }
    const counts = s.counts();
    const present = TYPES.filter((t) => counts.get(t)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
    if (!present.length) {
      body.replaceChildren(
        h(
          'p',
          { class: 'empty' },
          s.status === 'syncing' ? 'Fetching the world…' : s.canWrite ? 'Nothing here yet. Tap the + to catch the first idea.' : 'This world is empty.',
        ),
      );
      return;
    }
    const shown = showAll ? present : present.slice(0, 9);
    const tiles = shown.map((t) =>
      h(
        'a',
        { class: 'type-tile', href: `#/w/${s.id}/t/${t}`, style: `--type:${typeColor(t)}` },
        h('b', null, typePlural(t)),
        h('span', null, (counts.get(t) ?? 0).toLocaleString('en')),
      ),
    );
    const more =
      present.length > 9
        ? (() => {
            const b = h('button', { class: 'btn btn-quiet', type: 'button' }, showAll ? 'Fewer types' : `All ${present.length} types`);
            b.addEventListener('click', () => {
              showAll = !showAll;
              renderBody();
            });
            return b;
          })()
        : null;
    const unsorted = s.elements().filter((e) => e.type === 'narrative' && e.supertype === 'Unsorted');
    body.replaceChildren(
      unsorted.length
        ? h(
            'a',
            { class: 'choice', href: `#/w/${s.id}/t/narrative?unsorted` },
            h('b', null, `Unsorted · ${unsorted.length}`),
            h('span', null, 'Caught and not yet turned into elements'),
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
    { class: 'screen', 'data-screen': 'home' },
    head,
    banner,
    h('label', { class: 'search' }, icon('search', 20), input),
    body,
    s.canWrite
      ? h('a', { class: 'fab', href: `#/w/${s.id}/capture`, 'aria-label': 'Catch an idea' }, icon('plus', 30, 2.2))
      : null,
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
  const add = s.canWrite
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
      { class: 'screen', 'data-screen': 'type' },
      topbar(onlyUnsorted ? 'Unsorted' : typePlural(type), `#/w/${s.id}`, ...(add ? [add] : [])),
      banner,
      h('label', { class: 'search' }, icon('search', 20), input),
      count,
      list,
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

export function elementView(s: WorldSession, id: string): View {
  const main = h('main', { class: 'screen', 'data-screen': 'element' });
  let showEmpty = false;
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
      );
      return;
    }
    const pending = s.pending(id);
    const editable = s.canWrite;
    const wait = (f: string) => {
      const row = pending.get(f) ?? pending.get('*');
      if (!row) return null;
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

    const avatar = h('div', { class: 'avatar', style: `--type:${typeColor(el.type)}`, 'aria-hidden': 'true' });
    if (typeof el.image_url === 'string' && /^(https:|data:image\/)/.test(el.image_url)) {
      avatar.style.backgroundImage = `url("${el.image_url}")`;
    } else avatar.textContent = initials(elName(el));

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
      const isBlock = info.type === 'multi_link' || (info.type === 'text' && String(v).length > 28);
      rows.push(
        tapRow(
          field,
          h(
            'div',
            { class: `frow${isBlock ? ' block' : ''}`, 'data-field': field },
            h('span', { class: 'k' }, fieldLabel(field), wait(field)),
            h('span', { class: 'v' }, valueNode(s, el.type, field, v)),
          ),
        ),
      );
    }
    const emptyRows = showEmpty
      ? empty.map((f) =>
          tapRow(f, h('div', { class: 'frow', 'data-field': f }, h('span', { class: 'k' }, fieldLabel(f)), h('span', { class: 'v muted' }, '·'))),
        )
      : [];
    if (!desc && editable) empty.unshift('description');

    const links = s.backlinks(id);
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
      empty.length > 0
        ? (() => {
            const b = h('button', { class: 'btn btn-quiet', type: 'button' }, showEmpty ? 'Hide the empty fields' : `Show the ${empty.length} empty fields`);
            b.addEventListener('click', () => {
              showEmpty = !showEmpty;
              refresh();
            });
            return b;
          })()
        : null;
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
      h('div', { class: 'el-head' }, avatar, headText),
      descNode ?? '',
      h('div', { class: 'fields' }, ...rows, ...emptyRows, backNode ?? ''),
      toggle ?? '',
      editable ? h('p', { class: 'muted small', style: 'margin:0' }, 'Tap a value to change it.') : '',
    );
  };
  refresh();
  return { el: main, refresh };
}

export function notFound(text: string, back = '#/'): HTMLElement {
  return h('main', { class: 'screen' }, topbar('Not here', back), h('p', { class: 'empty' }, text));
}
