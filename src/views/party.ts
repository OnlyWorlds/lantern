// Give it to the party: the sheet a game master fills at the table, and the one question it asks
// the first time (which Collective is the party; the Captain's board, h37 B28, lean A: kept per world).
import type { OwElement } from '@onlyworlds/sdk';
import { h, plural } from '../dom';
import { partyChoices, partySize, revealValues } from '../party';
import { noteGiven } from '../given';
import { elName, errorText, go, sheet, toast } from '../ui';
import type { WorldSession } from '../world';

interface Draft {
  name: string;
  line: string;
}

/** The party this world remembers, if it is still in the world. */
function rememberedParty(s: WorldSession): OwElement | undefined {
  const p = s.rec.partyId ? s.get(s.rec.partyId) : undefined;
  return p?.type === 'collective' ? p : undefined;
}

export function giveToParty(s: WorldSession, thing: OwElement, draft?: Draft): void {
  const party = rememberedParty(s);
  if (!party) {
    chooseParty(s, () => giveToParty(s, thing, draft));
    return;
  }
  sheet((close) => {
    const name = h('input', { class: 'input', type: 'text', autocomplete: 'off' });
    name.value = draft?.name ?? thing.name ?? '';
    const line = h('textarea', {
      class: 'textarea',
      placeholder: 'What they see, hear or learn about it',
      style: 'min-height:96px',
    });
    line.value = draft?.line ?? '';
    const pic = typeof thing.image_url === 'string' && /^(https:|data:image\/)/.test(thing.image_url) ? thing.image_url : '';
    const size = partySize(party);
    const change = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Change');
    change.addEventListener('click', () => {
      close();
      chooseParty(s, () => giveToParty(s, thing, { name: name.value, line: line.value }), true);
    });
    const err = h('p', { class: 'error', role: 'alert' });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const ok = h('button', { class: 'btn btn-standard', type: 'submit' }, 'Give it');
    const form = h(
      'form',
      { class: 'stack' },
      h('label', { class: 'field-label' }, 'What the party sees', name),
      h('label', { class: 'field-label' }, 'Your line', line),
      pic
        ? h(
            'div',
            { class: 'give-row' },
            h('img', { class: 'give-thumb', src: pic, alt: `The picture of ${elName(thing)}` }),
            h('span', { class: 'muted small' }, 'The party sees its picture too.'),
          )
        : h('p', { class: 'muted small', style: 'margin:0' }, 'No picture: the party sees the name and your line.'),
      h(
        'div',
        { class: 'give-row' },
        h('span', { class: 'dim', style: 'flex:1;min-width:0' }, 'To ', h('b', null, elName(party)), ` · ${plural(size, 'Character')}`),
        change,
      ),
      size
        ? ''
        : h(
            'p',
            { class: 'note', role: 'note' },
            h('span', null, `No Character is in ${elName(party)} yet, so no player sees this. Add your players' Characters to it: `, h('a', { href: `#/w/${s.id}/e/${party.id}` }, `open ${elName(party)}`), '.'),
          ),
      h('p', { class: 'muted small', style: 'margin:0' }, `${elName(thing)} stays as hidden as it was: they get this, not its page.`),
      err,
      h('div', { class: 'row-gap' }, cancel, ok),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) {
        err.textContent = 'Give it a name the party sees.';
        return;
      }
      ok.disabled = true;
      try {
        const id = await s.create('narrative', revealValues(thing, party.id, name.value, line.value));
        noteGiven(s.id, id);
        // It is in the outbox, not yet with keel: the toast says so (a PIN may still be needed).
        toast(navigator.onLine ? `Sending to ${elName(party)}…` : `Kept on this phone. ${elName(party)} sees it when you have signal.`);
        // Left during the write (a navigation closed the sheet): the user is elsewhere now, stay there.
        if (!form.isConnected) return;
        close();
        go(`#/w/${s.id}/e/${id}`);
      } catch (ex) {
        err.textContent = errorText(ex);
        ok.disabled = false;
      }
    });
    return [h('h2', null, 'Give it to the party'), form];
  }, 'Give it to the party');
}

/** Which Collective is the party: asked once per world, kept, and changed from the give sheet. */
function chooseParty(s: WorldSession, then: () => void, changing = false): void {
  sheet((close) => {
    const err = h('p', { class: 'error', role: 'alert' });
    const list = h('div', { class: 'stack' });
    // A Collective made here and not yet remembered (the write failed): a retry uses it, never a second one.
    let made: string | null = null;
    // One choice at a time: every row waits while one is being kept.
    const pick = async (choose: () => Promise<string>) => {
      const all = [...list.querySelectorAll('button')];
      all.forEach((b) => (b.disabled = true));
      err.textContent = '';
      try {
        await s.rememberParty(await choose());
        if (!list.isConnected) return; // left meanwhile: no sheet opens on another screen
        close();
        then();
      } catch (ex) {
        err.textContent = errorText(ex);
        all.forEach((b) => (b.disabled = false));
      }
    };
    for (const c of partyChoices(s.elements())) {
      const b = h(
        'button',
        { class: 'choice', type: 'button', 'aria-pressed': c.id === s.rec.partyId ? 'true' : null },
        h('b', null, elName(c)),
        h('span', null, [c.id === s.rec.partyId ? 'The party now' : c.supertype, plural(partySize(c), 'Character')].filter(Boolean).join(' · ')),
      );
      b.addEventListener('click', () => void pick(async () => c.id));
      list.appendChild(b);
    }
    const fresh = h('button', { class: 'choice', type: 'button' }, h('b', null, 'A new one called The Party'), h('span', null, "Then add your players' Characters to it"));
    fresh.addEventListener('click', () => void pick(async () => (made ??= await s.create('collective', { name: 'The Party', supertype: 'Party' }))));
    list.appendChild(fresh);
    return [
      h('h2', null, changing ? 'Change the party' : 'Which Collective is the party?'),
      h('p', { class: 'dim', style: 'margin:0' }, 'Every player whose Character is in it sees what you give. Lantern keeps your choice for this world.'),
      list,
      err,
    ];
  }, 'Which Collective is the party?');
}
