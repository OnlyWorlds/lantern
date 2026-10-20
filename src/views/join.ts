// Join a world with an invite link: paste it (or share it to Lantern), see the invite, join.
import { h } from '../dom';
import { accountToken } from '../account';
import { acceptJoin, isPlayerLink, isTable, joinCode, pendingJoin, PickRefused, previewJoin, redeemPlayer, roleWords, setPendingJoin, tablePicks, type JoinPreview, type TablePick } from '../join';
import { errorText, go, topbar } from '../ui';

function whenText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export async function joinView(given?: string | null): Promise<HTMLElement> {
  const [token, waiting] = await Promise.all([accountToken(), pendingJoin()]);
  const input = h('input', {
    class: 'input',
    // Text, not url: a bare code is a fine answer, and a url field would refuse it unseen.
    type: 'text',
    inputmode: 'url',
    'aria-label': 'Invite link',
    placeholder: 'https://www.onlyworlds.com/join#ow_j_…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  input.value = given ?? waiting ?? '';
  const err = h('p', { class: 'error', role: 'alert' });
  const look = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Look at the invite');
  const card = h('div', { class: 'stack' });
  const form = h('form', { class: 'stack' }, input, err, look);

  const showInvite = (code: string, p: JoinPreview, said = '') => {
    // The invite is on screen: joining is the action now, looking again the quiet one.
    look.classList.remove('btn-primary');
    const who = p.invited_by || p.owner_character || 'Someone';
    const until = whenText(p.expires_at);
    if (p.reader === 'agent') {
      card.replaceChildren(h('p', { class: 'banner' }, 'This link is for an AI agent, not a person. Ask for an invite link for a person.'));
      return;
    }
    if (isPlayerLink(p)) {
      showPlayer(code, p, who, until, said);
      return;
    }
    const join = h('button', { class: 'btn btn-primary', type: 'button' }, token ? `Join ${p.world.name}` : 'Sign in to join');
    const joinErr = h('p', { class: 'error', role: 'alert' });
    join.addEventListener('click', async () => {
      joinErr.textContent = '';
      if (!token) {
        // The code waits through the sign-in, and this screen opens again after it.
        await setPendingJoin(code);
        go('#/signin');
        return;
      }
      join.disabled = true;
      try {
        const r = await acceptJoin(code);
        if ('already' in r) {
          joinErr.textContent = `You are in ${p.world.name} already: it is in Your worlds.`;
          join.disabled = false;
          return;
        }
        go(`#/w/${r.worldId}`, true);
      } catch (e) {
        joinErr.textContent = errorText(e);
        join.disabled = false;
      }
    });
    card.replaceChildren(
      h(
        'div',
        { class: 'invite' },
        h('p', { style: 'margin:0' }, `${who} invites you to `, h('b', null, p.world.name), ` as ${roleWords(p.role)}.`),
        p.world.description ? h('p', { class: 'dim small', style: 'margin:0' }, p.world.description) : '',
        until ? h('p', { class: 'muted small', style: 'margin:0' }, `The link works once, until ${until}.`) : '',
      ),
      join,
      joinErr,
    );
  };

  // A player link (Keel #353): no account and no PIN, a name if they like, then the world opens
  // to read as the Character the game master gave them.
  // A table (keel #422 PR 2, Seethe's frame 5): one link for several players, each picking who they
  // are from the owner's list; a table with no list asks each player's name for a fresh Character.
  const showPlayer = (code: string, p: JoinPreview, who: string, until: string, said = '') => {
    const table = isTable(p);
    const askName = table && !!p.name_required;
    const name = h('input', {
      class: 'input',
      type: 'text',
      maxlength: '80',
      autocomplete: 'nickname',
      'aria-label': 'Your name',
      placeholder: askName ? 'Your name' : 'Your name (optional)',
    }) as HTMLInputElement;
    const open = h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'open-player' }, `Open ${p.world.name}`) as HTMLButtonElement;
    const openErr = h('p', { class: 'error', role: 'alert' });
    // A refused pick's sentence sits above the list it sends the player back to.
    const pickErr = h('p', { class: 'error', role: 'alert', 'data-role': 'pick-refused', style: 'margin:0' }, said);
    const picks = table && !askName ? tablePicks(p) : [];
    const free = picks.filter((c) => !c.taken);
    let picked: TablePick | null = null;
    const choose = (c: TablePick) => {
      picked = c;
      for (const b of list.querySelectorAll<HTMLButtonElement>('[data-pick]')) b.setAttribute('aria-pressed', String(b.dataset.pick === c.id));
      open.textContent = `Open ${p.world.name} as ${c.name}`;
      open.disabled = false;
    };
    const list = h('div', { class: 'stack', role: 'group', 'aria-label': 'Who are you at this table?' });
    for (const c of picks) {
      const b = h(
        'button',
        { class: 'choice pick', type: 'button', 'data-pick': c.id, 'aria-pressed': 'false', ...(c.taken ? { disabled: '' } : {}) },
        h('b', null, c.name),
        c.taken ? h('span', null, 'taken') : '',
      ) as HTMLButtonElement;
      if (!c.taken) b.addEventListener('click', () => choose(c));
      list.append(b);
    }
    if (table && !askName) {
      open.disabled = true;
      open.textContent = 'Pick who you are';
    }
    open.addEventListener('click', async () => {
      openErr.textContent = '';
      if (askName && !name.value.trim()) {
        openErr.textContent = 'Type your name: your Character takes it, and the game master sees it.';
        name.focus();
        return;
      }
      open.disabled = true;
      try {
        const r = await redeemPlayer(code, name.value, table ? { character: picked?.id } : undefined);
        go(`#/w/${r.worldId}`, true);
      } catch (e) {
        if (e instanceof PickRefused) {
          // Taken a moment ago, or off the list now: look again, so the list on screen is keel's.
          const text = e.message;
          try {
            showInvite(code, await previewJoin(code), text);
          } catch (ex) {
            openErr.textContent = errorText(ex);
          }
          return;
        }
        openErr.textContent = errorText(e);
        open.disabled = false;
      }
    });
    const left = p.uses_left ?? 0;
    const times = table
      ? `The link works ${p.max_uses} times${until ? `, until ${until}` : ''}. ${left === 1 ? 'One place is left.' : `${left} places are left.`}`
      : until
        ? `The link works once, until ${until}.`
        : '';
    const body: (Node | string)[] = [];
    if (table && !askName && free.length === 0) {
      body.push(h('p', { class: 'banner' }, 'Every Character on this link is taken. Ask the game master.'));
    } else {
      if (table && !askName) {
        body.push(h('h2', { class: 'field-label', style: 'margin:0' }, 'Who are you at this table?'), ...(said ? [pickErr] : []), list, h('p', { class: 'muted small', style: 'margin:0' }, 'Only these names: the game master chose them.'));
      }
      body.push(
        h('label', { class: 'field-label' }, askName ? 'Your name: your Character takes it, and the game master sees it' : 'Your name, as the game master sees it', name),
        open,
      );
    }
    card.replaceChildren(
      h(
        'div',
        { class: 'invite' },
        h('p', { style: 'margin:0' }, `${who} invites you to play in `, h('b', null, p.world.name), '.'),
        p.world.description ? h('p', { class: 'dim small', style: 'margin:0' }, p.world.description) : '',
        h('p', { class: 'dim small', style: 'margin:0' }, askName ? 'You get a Character of your own and read the world as it, with no account. Notes you keep stay on this phone.' : 'You read the world as your Character, with no account. Notes you keep stay on this phone.'),
        times ? h('p', { class: 'muted small', style: 'margin:0' }, times) : '',
      ),
      ...body,
      openErr,
    );
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    card.replaceChildren();
    const code = joinCode(input.value);
    if (!code) {
      err.textContent = 'That is not an invite link. It looks like https://www.onlyworlds.com/join#ow_j_…';
      return;
    }
    look.disabled = true;
    try {
      showInvite(code, await previewJoin(code));
    } catch (ex) {
      err.textContent = errorText(ex);
    } finally {
      look.disabled = false;
    }
  });

  const main = h(
    'main',
    { class: 'screen', 'data-screen': 'join' },
    topbar('Join a world', token ? '#/worlds' : '#/welcome'),
    h('p', { class: 'dim', style: 'margin:0' }, 'Paste the invite link someone sent you.'),
    form,
    card,
  );
  // A link that came with the screen (shared to Lantern, or waiting through a sign-in) is looked at at once.
  // After the screen is in the page: a form outside the document does not submit.
  if (input.value && joinCode(input.value)) setTimeout(() => form.isConnected && form.requestSubmit(), 0);
  return main;
}
