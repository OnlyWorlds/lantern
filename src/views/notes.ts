// A player's own notes (src/notes.ts): written at the table, kept on this phone, and one at a time
// shared with the party (the Captain h37 #4420, B; keel #241).
import { OwV2Client, type OwElement } from '@onlyworlds/sdk';
import { mintPlayerKey } from '../account';
import { h, plural } from '../dom';
import { addNote, markShared, notes, removeNote, unmarkShared, type Note } from '../notes';
import { circlesOf, sharedNoteValues } from '../party';
import { pinFor, setPin } from '../pin';
import { uuid7 } from '../uuid7';
import { elName, errorText, sheet, tabbar, toast, topbar } from '../ui';
import { API_BASE, type WorldSession } from '../world';
import { pinSheet, type View } from './world';

/** Worlds with a share in flight on this phone. */
const sharing = new Set<string>();

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function notesView(s: WorldSession): View {
  const input = h('textarea', { class: 'textarea', 'aria-label': 'A note', placeholder: 'What you want to remember' });
  const list = h('div', { class: 'stack', 'data-part': 'notes' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save the note');
  const form = h('form', { class: 'stack' }, input, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    if (!addNote(s.id, input.value)) {
      toast('This phone would not keep the note.');
      return;
    }
    input.value = '';
    refresh();
  });
  const refresh = () => {
    const all = notes(s.id);
    list.replaceChildren(...(all.length ? [h('p', { class: 'section-label' }, plural(all.length, 'note'))] : []), ...all.map((n) => noteCard(s, n, refresh)));
  };
  refresh();
  return {
    el: h(
      'main',
      { class: 'screen has-tabbar', 'data-screen': 'notes' },
      topbar('My notes', `#/w/${s.id}`),
      h(
        'p',
        { class: 'dim', style: 'margin:0' },
        s.rec.playerSeat
          ? 'Kept on this phone, and they stay here when you have no signal. Nobody else sees them: sharing with the party needs an account, and an invite to join with it.'
          : 'Kept on this phone, and they stay here when you have no signal. Nobody else sees one until you share it with the party.',
      ),
      form,
      list,
      tabbar(s, 'catch'),
    ),
    // The share going out (or refused) redraws the card's line.
    refresh,
  };
}

function noteCard(s: WorldSession, n: Note, refresh: () => void): HTMLElement {
  const rm = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'remove-note' }, 'Remove');
  let armed = false;
  rm.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      rm.textContent = n.shared ? 'Remove it from this phone? The party keeps it. Tap again' : 'Remove this note? Tap again';
      return;
    }
    removeNote(s.id, n.id);
    refresh();
  });
  const actions = h('div', { class: 'row-gap', style: 'flex-wrap:wrap' });
  const line = n.shared ? sharedLine(s, n.shared) : null;
  // Shareable while it is not on its way or in the world: never shared, refused, or no longer there.
  // Never from a player seat (Keel #353): its key only reads, and no account can make one that writes.
  if (!s.rec.playerSeat && (!line || line.open)) {
    const share = h('button', { class: 'btn', type: 'button', 'data-action': 'share-note' }, n.shared ? 'Share it again' : 'Share with the party');
    share.addEventListener('click', () => shareNote(s, n, refresh));
    actions.append(share, rm);
  } else actions.append(rm);
  return h(
    'div',
    { class: 'note-card', 'data-note': n.id, 'data-shared': n.shared ? 'yes' : null },
    h('p', { class: 'prose', style: 'margin:0' }, n.text),
    h('span', { class: 'muted small' }, when(n.at)),
    line?.el ?? '',
    actions,
  );
}

/**
 * Where a shared note stands: waiting to send, in the world, refused (its reason, the row in
 * Waiting to send), or not there (never queued, let go, or removed by the game master). `open`:
 * it may be shared again (the S406 gate, G3).
 */
function sharedLine(s: WorldSession, shared: NonNullable<Note['shared']>): { el: HTMLElement; open: boolean } {
  const line = (...parts: (Node | string)[]) => h('span', { class: 'small', 'data-part': 'share-state' }, ...parts);
  if (s.pending(shared.id).get('*')) {
    if (s.pinKnown()) return { el: line(`Waiting to send to ${shared.to}`), open: false };
    const enter = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Enter your PIN');
    enter.addEventListener('click', () => pinSheet(s));
    return { el: line(`Waiting for your PIN to send to ${shared.to}. `, enter), open: false };
  }
  if (s.get(shared.id)) return { el: line(`Shared with ${shared.to} · `, h('a', { href: `#/w/${s.id}/e/${shared.id}` }, 'Open it')), open: false };
  const refused = s.refusedRow(shared.id);
  if (refused) return { el: line(`Not shared: ${refused.error ?? 'refused'} `, h('a', { href: `#/w/${s.id}/outbox` }, 'See it')), open: true };
  return { el: line(`Not with ${shared.to} now.`), open: true };
}

/** Share a note: which of the player's Collectives, then the sheet. */
function shareNote(s: WorldSession, n: Note, refresh: () => void): void {
  const me = s.rec.characterId ? s.get(s.rec.characterId) : undefined;
  const circles = circlesOf(s.elements(), s.rec.characterId);
  if (!s.rec.characterId || !circles.length) {
    sheet(
      (close) => {
        const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Got it');
        ok.addEventListener('click', close);
        return [
          h('h2', null, 'Share with the party'),
          h(
            'p',
            { class: 'dim', style: 'margin:0' },
            !s.rec.characterId
              ? 'A shared note is told by your Character, and you have none in this world yet. Ask your game master to give you one.'
              : `${me ? elName(me) : 'Your Character'} is in no group yet, so there is nobody to share with. Ask your game master to add ${me ? elName(me) : 'your Character'} to the party.`,
          ),
          ok,
        ];
      },
      'Share with the party',
    );
    return;
  }
  const kept = circles.find((c) => c.id === s.rec.partyId);
  if (kept || circles.length === 1) shareSheet(s, n, kept ?? circles[0], circles, refresh);
  else chooseCircle(s, circles, (c) => shareSheet(s, n, c, circles, refresh));
}

function chooseCircle(s: WorldSession, circles: OwElement[], then: (c: OwElement) => void): void {
  sheet((close) => {
    const list = h('div', { class: 'stack' });
    for (const c of circles) {
      const b = h(
        'button',
        { class: 'choice', type: 'button', 'aria-pressed': c.id === s.rec.partyId ? 'true' : null },
        h('b', null, elName(c)),
        h('span', null, [c.supertype, plural(Array.isArray(c.characters) ? c.characters.length : 0, 'Character')].filter(Boolean).join(' · ')),
      );
      b.addEventListener('click', async () => {
        await s.rememberParty(c.id).catch(() => undefined);
        close();
        then(c);
      });
      list.appendChild(b);
    }
    return [
      h('h2', null, 'Share with which group?'),
      h('p', { class: 'dim', style: 'margin:0' }, 'Your Character is in each of these. Everyone whose Character is in the one you pick sees the note. Lantern keeps your choice for this world.'),
      list,
    ];
  }, 'Share with which group?');
}

function shareSheet(s: WorldSession, n: Note, party: OwElement, circles: OwElement[], refresh: () => void): void {
  const me = s.rec.characterId ? s.get(s.rec.characterId) : undefined;
  sheet((close) => {
    const err = h('p', { class: 'error', role: 'alert' });
    // The PIN slot the share will use: the account's, which the world takes with its write key
    // (a per-world PIN held from before is not the account's; the S406 gate, G6).
    const pin = pinFor({ id: s.id, role: s.playerCanSend ? s.rec.role : (s.rec.role ?? 'collaborator') })
      ? null
      : h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', 'aria-label': 'PIN' });
    const change = circles.length > 1 ? h('button', { class: 'btn btn-quiet', type: 'button' }, 'Change') : null;
    change?.addEventListener('click', () => {
      close();
      chooseCircle(s, circles, (c) => shareSheet(s, n, c, circles, refresh));
    });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Share it');
    const form = h(
      'form',
      { class: 'stack' },
      h('p', { class: 'prose note-card', style: 'margin:0' }, n.text),
      h('div', { class: 'give-row' }, h('span', { class: 'dim', style: 'flex:1;min-width:0' }, 'To ', h('b', null, elName(party))), change ?? ''),
      h(
        'p',
        { class: 'muted small', style: 'margin:0' },
        `${me ? elName(me) : 'Your Character'} tells it. Everyone whose Character is in ${elName(party)} sees it, and so does your game master. It stays in My notes too.`,
      ),
      pin
        ? h(
            'label',
            { class: 'field-label' },
            'Your PIN',
            h('span', { class: 'muted small' }, 'The four digits you set on onlyworlds.com. Lantern keeps it on this phone until you sign out.'),
            pin,
          )
        : '',
      err,
      h('div', { class: 'row-gap' }, cancel, ok),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const typed = pin?.value.trim() ?? '';
      if (pin && !/^\d{4}$/.test(typed)) {
        err.textContent = 'Your PIN is four digits.';
        return;
      }
      if (!s.playerCanSend && !navigator.onLine) {
        err.textContent = 'Sharing your first note needs signal. It stays in My notes until then.';
        return;
      }
      // One share at a time per world: a sheet closed mid-share (Cancel, the backdrop, Back) and
      // opened again must not send the note twice or mint a second key (the S406 gate, G2).
      if (sharing.has(s.id)) {
        err.textContent = 'The last share is still on its way. Try again in a moment.';
        return;
      }
      sharing.add(s.id);
      ok.disabled = true;
      cancel.disabled = true;
      let marked = false;
      try {
        // The first share takes a write key for this player's seat; it is kept, so a wrong PIN
        // next does not mint another.
        if (!s.playerCanSend) await s.takePlayerKey(await mintPlayerKey(s.id, s.rec.characterId!));
        if (pin) {
          // keel checks a PIN sent on a read too: one read proves it before anything is written.
          try {
            await new OwV2Client({ apiKey: s.rec.apiKey!, apiPin: typed, baseUrl: API_BASE }).getWorld();
          } catch (ex) {
            throw (ex as { status?: number }).status === 401 ? new Error("That PIN is not your account's.") : ex;
          }
          setPin(s.rec, typed);
          s.needPin = false;
        }
        // Marked first, with the id it will go under: if the app dies before the row is queued,
        // the card offers it again and nothing was sent (the S406 gate, G7).
        const id = uuid7();
        marked = markShared(s.id, n.id, id, elName(party));
        if (!marked) throw new Error('This phone would not keep the note.');
        await s.shareNote(sharedNoteValues(n.text, party.id), id);
        toast(navigator.onLine ? `Sending to ${elName(party)}…` : `Kept on this phone. It goes to ${elName(party)} when you have signal.`);
        if (form.isConnected) close();
        refresh();
      } catch (ex) {
        if (marked) unmarkShared(s.id, n.id);
        err.textContent = errorText(ex);
        ok.disabled = false;
        cancel.disabled = false;
        refresh();
      } finally {
        sharing.delete(s.id);
      }
    });
    return [h('h2', null, 'Share with the party'), form];
  }, 'Share with the party');
}
