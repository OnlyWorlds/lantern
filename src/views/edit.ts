// Changing a value: one sheet per field kind. Every save goes to the outbox first.
import type { OwElement } from '@onlyworlds/sdk';
import { h } from '../dom';
import { icon } from '../icons';
import { search } from '../search';
import { fieldInfo, fieldLabel, typeColor, typeLabel } from '../schema';
import { elName, errorText, go, sheet, toast, typeChip } from '../ui';
import type { WorldSession } from '../world';

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
  const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, saveLabel);
  return { row: h('div', { class: 'row-gap' }, cancel, ok), ok };
}

export function editField(s: WorldSession, el: OwElement, field: string): void {
  const info = field === 'name' || field === 'description' || field === 'supertype' || field === 'subtype' ? { type: 'text' as const } : fieldInfo(el.type, field);
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
        inputmode: 'numeric',
        step: '1',
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
        if (!raw) v = null;
        else {
          const n = Number(raw);
          if (!Number.isInteger(n)) {
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
    return [h('h2', null, fieldLabel(field)), form];
  }, fieldLabel(field));
}

function linkSheet(s: WorldSession, el: OwElement, field: string, multi: boolean, target: string, base: OwElement | undefined): void {
  const start = el[field];
  let chosen: string[] = multi ? (Array.isArray(start) ? start.map(String) : []) : typeof start === 'string' ? [start] : [];
  sheet((close) => {
    const current = h('div', { class: 'chips' });
    const input = h('input', {
      class: 'input',
      type: 'search',
      placeholder: `Find a ${typeLabel(target).toLowerCase()}`,
      'aria-label': `Find a ${typeLabel(target).toLowerCase()}`,
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
      if (!els.length) results.appendChild(h('p', { class: 'muted small' }, q ? 'Nothing by that name.' : `No ${typeLabel(target).toLowerCase()} to link yet.`));
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
        go(`#/w/${s.id}/e/${id}`);
      } catch (ex) {
        err.textContent = errorText(ex);
      }
    });
    return [h('h2', null, `A new ${typeLabel(type).toLowerCase()}`), form];
  }, `A new ${typeLabel(type).toLowerCase()}`);
}
