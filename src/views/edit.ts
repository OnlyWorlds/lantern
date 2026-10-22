// Changing a value: one sheet per field kind. Every save goes to the outbox first.
import type { OwElement } from '@onlyworlds/sdk';
import { h } from '../dom';
import { icon } from '../icons';
import { search } from '../search';
import { customEditable, customFieldKey, customFieldProblem, customFields, fieldInfo, fieldLabel, isCustomField, isProfileField, typeColor, typeName, aTypeName } from '../schema';
import { elName, errorText, go, sheet, toast, typeChip } from '../ui';
import type { WorldSession } from '../world';
import { photoPicker } from './photo';

const SHORT_TEXT = new Set(['name', 'supertype', 'subtype']);

async function save(s: WorldSession, el: OwElement, values: Record<string, unknown>, close: () => void, base: OwElement | undefined): Promise<void> {
  try {
    await s.edit(el.id, values, base);
    close();
    if (!s.isLocal) toast(navigator.onLine ? 'Saved. Sending…' : 'Saved on this phone. It sends when you have signal.');
  } catch (e) {
    toast(errorText(e));
  }
}

function actions(close: () => void, saveLabel = 'Save'): { row: HTMLElement; ok: HTMLButtonElement } {
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  cancel.addEventListener('click', close);
  const ok = h('button', { class: 'btn btn-standard', type: 'submit' }, saveLabel);
  return { row: h('div', { class: 'row-gap' }, cancel, ok), ok };
}

export function editField(s: WorldSession, el: OwElement, field: string): void {
  // A custom field has no schema: its value says what it is (a number stays a number).
  const custom = isCustomField(field);
  if (custom && (isProfileField(field) || !customEditable(el[field] ?? ''))) return;
  const info =
    field === 'name' || field === 'description' || field === 'supertype' || field === 'subtype' || (custom && typeof el[field] !== 'number')
      ? { type: 'text' as const }
      : custom
        ? { type: 'integer' as const }
        : fieldInfo(el.type, field);
  if (!info) return;
  // The server's copy as the sheet opens it: the edit's base. Taken at save instead, a change
  // arriving while the sheet is open (the poll) would become the base and be overwritten
  // without a conflict (the S396 gate).
  const base = s.serverCopy(el.id);
  if (info.type === 'single_link' || info.type === 'multi_link') {
    linkSheet(s, el, field, info.type === 'multi_link', info.target ?? '', base);
    return;
  }
  sheet((close) => {
    const cur = el[field];
    let input: HTMLInputElement | HTMLTextAreaElement;
    if (info.type === 'text') {
      input = SHORT_TEXT.has(field)
        ? h('input', { class: 'input', type: 'text', 'aria-label': fieldLabel(field) })
        : h('textarea', { class: 'textarea', 'aria-label': fieldLabel(field) });
      input.value = typeof cur === 'string' ? cur : '';
    } else {
      input = h('input', {
        class: 'input',
        type: 'number',
        inputmode: custom ? 'decimal' : 'numeric',
        step: custom ? 'any' : '1',
        min: info.type === 'integer_max' ? '0' : null,
        max: info.type === 'integer_max' && info.max ? String(info.max) : null,
        'aria-label': fieldLabel(field),
      });
      input.value = typeof cur === 'number' ? String(cur) : '';
    }
    const err = h('p', { class: 'error', role: 'alert' });
    const { row } = actions(close);
    const form = h('form', { class: 'stack' }, input, err, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let v: unknown;
      if (info.type === 'text') {
        v = input.value;
        if (field === 'name' && !input.value.trim()) {
          err.textContent = 'A name cannot be empty.';
          return;
        }
      } else {
        const raw = input.value.trim();
        // A custom number emptied stays a field (Atlas: '' is live, null is removed); removing is Remove's.
        if (!raw) v = custom ? '' : null;
        else {
          const n = Number(raw);
          if (custom && !Number.isFinite(n)) {
            err.textContent = 'A number, please.';
            return;
          }
          if (!custom && !Number.isInteger(n)) {
            err.textContent = 'A whole number, please.';
            return;
          }
          if (info.type === 'integer_max' && info.max !== undefined && (n < 0 || n > info.max)) {
            err.textContent = `From 0 to ${info.max}.`;
            return;
          }
          v = n;
        }
      }
      void save(s, el, { [field]: v }, close, base);
    });
    if (!custom) return [h('h2', null, fieldLabel(field)), form];
    // A custom field goes as Atlas removes one: an explicit null, so the next read cannot bring it back.
    // The first tap asks; the second removes.
    const remove = h('button', { class: 'btn btn-quiet', type: 'button', style: 'align-self:center', 'data-action': 'remove-field' }, 'Remove this field');
    let armed = false;
    remove.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        remove.textContent = `Remove ${fieldLabel(field).toLowerCase()} and its value`;
        return;
      }
      void save(s, el, { [field]: null }, close, base);
    });
    return [h('h2', null, fieldLabel(field)), form, remove];
  }, fieldLabel(field));
}

/** A field of the world maker's own, named on the phone (Atlas's rule: "mood" is stored as x_mood). */
export function addFieldSheet(s: WorldSession, el: OwElement): void {
  const base = s.serverCopy(el.id);
  // The names this world already uses come first, so "Mood" here is the same field as "Mood" there.
  // A suggestion is the key it names (shadow_ included): picked, it is that field, never a new x_ one
  // (the S402 gate, G3). Two keys with one label offer the x_ one.
  const byLabel = new Map<string, string>();
  for (const f of new Set(s.lore().flatMap((e) => customFields(e as unknown as Record<string, unknown>)))) {
    if (el[f] !== undefined && el[f] !== null) continue;
    if (isProfileField(f)) continue;
    const k = fieldLabel(f).toLowerCase();
    if (!byLabel.has(k) || f.startsWith('x_')) byLabel.set(k, f);
  }
  const used = [...byLabel.values()].map(fieldLabel).sort((a, b) => a.localeCompare(b));
  sheet((close) => {
    const listId = `used-fields-${el.id}`;
    const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Field name', placeholder: 'Mood', list: used.length ? listId : null, autocapitalize: 'sentences' });
    const value = h('textarea', { class: 'textarea', 'aria-label': 'Value' });
    const err = h('p', { class: 'error', role: 'alert' });
    const { row } = actions(close, 'Add');
    const form = h(
      'form',
      { class: 'stack' },
      h('label', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'muted small' }, 'Name'), name),
      used.length ? h('datalist', { id: listId }, ...used.map((u) => h('option', { value: u }))) : '',
      h('label', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'muted small' }, 'Value'), value),
      err,
      row,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = byLabel.get(name.value.trim().toLowerCase()) ?? customFieldKey(name.value);
      const problem = customFieldProblem(el, key);
      if (problem) {
        err.textContent = problem;
        return;
      }
      void save(s, el, { [key]: value.value }, close, base);
    });
    return [h('h2', null, 'Add a field'), form];
  }, 'Add a field');
}

function linkSheet(s: WorldSession, el: OwElement, field: string, multi: boolean, target: string, base: OwElement | undefined): void {
  const start = el[field];
  let chosen: string[] = multi ? (Array.isArray(start) ? start.map(String) : []) : typeof start === 'string' ? [start] : [];
  sheet((close) => {
    const current = h('div', { class: 'chips' });
    const input = h('input', {
      class: 'input',
      type: 'search',
      placeholder: `Find ${aTypeName(target)}`,
      'aria-label': `Find ${aTypeName(target)}`,
      autocomplete: 'off',
    });
    const results = h('div', { class: 'picker-results' });
    const renderCurrent = () => {
      current.replaceChildren(
        ...chosen.map((id) => {
          const t = s.get(id);
          const b = h(
            'button',
            { class: 'link-chip', type: 'button', style: `--type:${typeColor(target)}`, 'aria-label': `Remove ${elName(t)}` },
            elName(t),
            icon('close', 14, 2),
          );
          b.addEventListener('click', () => {
            chosen = chosen.filter((x) => x !== id);
            renderCurrent();
            renderResults();
          });
          return b;
        }),
      );
      if (!chosen.length) current.appendChild(h('span', { class: 'muted small' }, 'None yet'));
    };
    const pool = () => s.ofType(target);
    const renderResults = () => {
      const q = input.value.trim();
      const els = (q ? search(pool(), q, 30).map((x) => x.el) : pool().slice(0, 30)).filter((x) => !chosen.includes(x.id) && x.id !== el.id);
      results.replaceChildren(
        ...els.map((x) => {
          const b = h('button', { class: 'el-row', type: 'button', style: 'background:transparent;border-left:0;border-right:0;border-top:0;width:100%;text-align:left' }, typeChip(x.type), h('span', { class: 'label' }, h('b', null, elName(x))));
          b.addEventListener('click', () => {
            if (multi) {
              chosen = [...chosen, x.id];
              input.value = '';
              renderCurrent();
              renderResults();
            } else {
              void save(s, el, { [field]: x.id }, close, base);
            }
          });
          return b;
        }),
      );
      if (!els.length) results.appendChild(h('p', { class: 'muted small' }, q ? 'Nothing by that name.' : `No ${typeName(target)} to link yet.`));
    };
    input.addEventListener('input', renderResults);
    renderCurrent();
    renderResults();
    const { row, ok } = actions(close, multi ? 'Save' : 'Clear it');
    const form = h('form', { class: 'stack' }, h('label', { class: 'search' }, icon('search', 20), input), results, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void save(s, el, { [field]: multi ? chosen : null }, close, base);
    });
    if (!multi && !chosen.length) ok.style.display = 'none';
    return [h('h2', null, fieldLabel(field)), current, form];
  }, fieldLabel(field));
}

/**
 * The element's picture: a new one from the camera or the gallery, or none. A photo goes to the
 * outbox like any change (uploaded first, then set as image_url); "none" writes the empty string,
 * which is what keel serves for no picture.
 */
export function pictureSheet(s: WorldSession, el: OwElement, has: boolean): void {
  const base = s.serverCopy(el.id);
  sheet((close) => {
    const err = h('p', { class: 'error', role: 'alert' });
    const done = (text: string) => {
      close();
      toast(s.isLocal ? text : navigator.onLine ? `${text} Sending…` : `${text} It sends when you have signal.`);
    };
    const picker = photoPicker(
      (photo) => {
        // Shrinking a big photo takes a moment: a sheet closed meanwhile was a no (the S398 gate).
        if (!picker.row.isConnected) return;
        s.edit(el.id, {}, base, photo).then(
          () => done('Picture saved.'),
          (e) => (err.textContent = errorText(e)),
        );
      },
      (m) => (err.textContent = m),
    );
    const remove = has
      ? (() => {
          const b = h('button', { class: 'btn btn-quiet', type: 'button', style: 'align-self:center' }, 'Remove the picture');
          b.addEventListener('click', () => {
            s.edit(el.id, { image_url: '' }, base).then(
              () => done('Picture removed.'),
              (e) => (err.textContent = errorText(e)),
            );
          });
          return b;
        })()
      : '';
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    return [h('h2', null, has ? 'The picture' : 'Add a picture'), picker.row, err, ...(remove ? [remove] : []), cancel];
  }, 'The picture');
}

/**
 * Delete, after one warning (the Captain, h37 #4292: "a warning is enough to let it be on the users'
 * head"). Leaves for the list it came from, since the page it was on is gone.
 */
export function deleteSheet(s: WorldSession, el: OwElement): void {
  sheet((close) => {
    const name = elName(el);
    const err = h('p', { class: 'error', role: 'alert' });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const ok = h('button', { class: 'btn btn-delete-confirm', type: 'button', 'data-action': 'confirm-delete' }, 'Delete');
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        await s.remove(el.id);
        close();
        const unsorted = el.type === 'narrative' && el.supertype === 'Unsorted';
        toast(s.isLocal || navigator.onLine ? `Deleted ${name}.` : `Deleted ${name} on this phone. It sends when you have signal.`);
        go(`#/w/${s.id}/t/${el.type}${unsorted ? '?unsorted' : ''}`, true);
      } catch (ex) {
        err.textContent = errorText(ex);
        ok.disabled = false;
      }
    });
    return [
      h('h2', null, `Delete ${name}?`),
      h('p', { class: 'dim', style: 'margin:0' }, `This can't be undone. Links to it from the rest of the world go too.`),
      err,
      h('div', { class: 'row-gap' }, cancel, ok),
    ];
  }, `Delete ${elName(el)}`);
}

export function newElementSheet(s: WorldSession, type: string): void {
  sheet((close) => {
    const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Name', placeholder: 'Name' });
    const err = h('p', { class: 'error', role: 'alert' });
    const { row } = actions(close, 'Make it');
    const form = h('form', { class: 'stack' }, name, err, row);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) {
        err.textContent = 'Give it a name.';
        return;
      }
      try {
        const id = await s.create(type, { name: name.value.trim() });
        close();
        go(`#/w/${s.id}/e/${id}?fill`);
      } catch (ex) {
        err.textContent = errorText(ex);
      }
    });
    return [h('h2', null, `A new ${typeName(type)}`), form];
  }, `A new ${typeName(type)}`);
}
