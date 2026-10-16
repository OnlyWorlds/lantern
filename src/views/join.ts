// Join a world with an invite link: paste it (or share it to Lantern), see the invite, join.
import { h } from '../dom';
import { accountToken } from '../account';
import { acceptJoin, isPlayerLink, joinCode, pendingJoin, previewJoin, redeemPlayer, roleWords, setPendingJoin, type JoinPreview } from '../join';
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

  const showInvite = (code: string, p: JoinPreview) => {
    // The invite is on screen: joining is the action now, looking again the quiet one.
    look.classList.remove('btn-primary');
    const who = p.invited_by || p.owner_character || 'Someone';
    const until = whenText(p.expires_at);
    if (p.reader === 'agent') {
      card.replaceChildren(h('p', { class: 'banner' }, 'This link is for an AI agent, not a person. Ask for an invite link for a person.'));
      return;
    }
    if (isPlayerLink(p)) {
      showPlayer(code, p, who, until);
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
  const showPlayer = (code: string, p: JoinPreview, who: string, until: string) => {
    const name = h('input', {
      class: 'input',
      type: 'text',
      maxlength: '80',
      autocomplete: 'nickname',
      'aria-label': 'Your name',
      placeholder: 'Your name (optional)',
    }) as HTMLInputElement;
    const open = h('button', { class: 'btn btn-primary', type: 'button' }, `Open ${p.world.name}`) as HTMLButtonElement;
    const openErr = h('p', { class: 'error', role: 'alert' });
    open.addEventListener('click', async () => {
      openErr.textContent = '';
      open.disabled = true;
      try {
        const r = await redeemPlayer(code, name.value);
        go(`#/w/${r.worldId}`, true);
      } catch (e) {
        openErr.textContent = errorText(e);
        open.disabled = false;
      }
    });
    card.replaceChildren(
      h(
        'div',
        { class: 'invite' },
        h('p', { style: 'margin:0' }, `${who} invites you to play in `, h('b', null, p.world.name), '.'),
        p.world.description ? h('p', { class: 'dim small', style: 'margin:0' }, p.world.description) : '',
        h('p', { class: 'dim small', style: 'margin:0' }, 'You read the world as your Character, with no account. Notes you keep stay on this phone.'),
        until ? h('p', { class: 'muted small', style: 'margin:0' }, `The link works once, until ${until}.`) : '',
      ),
      h('label', { class: 'field-label' }, 'Your name, as the game master sees it', name),
      open,
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
