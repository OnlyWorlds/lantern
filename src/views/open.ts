// The open door's screen (src/opendoor.ts): says what a link to a world will do, and asks before a
// world from the account is put on this phone.
import { h } from '../dom';
import * as db from '../db';
import { accountName, accountToken, fetchAccountWorlds, openAccountWorld } from '../account';
import { clearPendingOpen, decideOpen, hashFor, holdThroughSignIn, homeHash, pendingOpen, type OpenWant } from '../opendoor';
import { errorText, go, topbar } from '../ui';

export const OPEN_MALFORMED_LINE = 'This link to open a world is not complete. Open it again from onlyworlds.com.';
export const OPEN_SIGN_IN_LINE = 'Sign in to open this world on this phone. It opens after you sign in.';
export const OPEN_OFFLINE_LINE = 'Opening a world on this phone needs a connection. Try again when you have signal.';
export const OPEN_SIGNED_OUT_LINE = 'OnlyWorlds no longer takes this phone\'s sign-in. Sign in again, and the world opens after.';

/** The world's page, with its home under an element in history, so Back from the element stays in the world. */
function land(want: OpenWant): void {
  if (want.element) {
    history.replaceState(null, '', '/' + homeHash(want));
    go(hashFor(want));
  } else go(homeHash(want), true);
}

export function openView(): HTMLElement {
  const main = h('main', { class: 'screen', 'data-screen': 'open' });
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Opening…'));
  const bar = topbar('Open a world', '#/worlds');
  main.append(bar, body);
  // Each render is one reading of the link; a later one, or leaving the screen, ends it.
  let generation = 0;
  let read: OpenWant | undefined;
  const leave = () => void clearPendingOpen(read);
  bar.querySelector('a')?.addEventListener('click', leave);

  const notNow = () => {
    const a = h('a', { class: 'btn btn-quiet', href: '#/worlds', style: 'align-self:center' }, 'Not now');
    a.addEventListener('click', leave);
    return a;
  };
  const tryAgain = () => {
    const b = h('button', { class: 'btn', type: 'button' }, 'Try again');
    b.addEventListener('click', () => void render());
    return b;
  };
  const signIn = (text: string) => h('a', { class: 'btn btn-primary', href: '#/signin' }, text);

  const render = async (): Promise<void> => {
    const mine = ++generation;
    const current = () => mine === generation && main.isConnected;
    body.replaceChildren(h('p', { class: 'muted' }, 'Opening…'));
    const want = await pendingOpen();
    read = want;
    const token = await accountToken();
    const step = await decideOpen(want, {
      onPhone: async (id) => Boolean(await db.getWorldRecord(id)),
      token: async () => token,
      online: () => navigator.onLine,
      accountWorlds: () => fetchAccountWorlds(),
      accountName,
    });
    if (!current()) return;
    switch (step.kind) {
      case 'none':
        go('#/worlds', true);
        return;
      case 'here':
        await clearPendingOpen(want);
        if (current()) land(want!);
        return;
      case 'malformed':
        await clearPendingOpen(want);
        body.replaceChildren(h('p', { class: 'empty' }, OPEN_MALFORMED_LINE));
        return;
      case 'signin':
        await holdThroughSignIn();
        body.replaceChildren(h('p', null, OPEN_SIGN_IN_LINE), signIn('Sign in'), notNow());
        return;
      case 'offline':
        body.replaceChildren(h('p', null, OPEN_OFFLINE_LINE), tryAgain(), notNow());
        return;
      case 'unread':
        if (step.signIn) {
          await holdThroughSignIn();
          body.replaceChildren(h('p', null, OPEN_SIGNED_OUT_LINE), signIn('Sign in again'), notNow());
        } else {
          body.replaceChildren(h('p', { class: 'error', role: 'alert' }, errorText(step.error)), tryAgain(), notNow());
        }
        return;
      case 'not-yours':
        await clearPendingOpen(want);
        body.replaceChildren(
          h(
            'p',
            null,
            `This world is not among the worlds of ${step.who ?? 'the account this phone is signed in with'} on OnlyWorlds. If another account holds it, sign in to Lantern with that one, then open the world again from onlyworlds.com.`,
          ),
          h('a', { class: 'btn', href: '#/worlds' }, 'Your worlds'),
        );
        return;
      case 'ask': {
        const w = step.world;
        const whose = w.role === 'owner' ? '' : w.member_role === 'guest' ? 'You are a player in it.' : 'It is shared with you.';
        const open = h('button', { class: 'btn btn-primary wrap-name', type: 'button', 'data-action': 'open-world' }, 'Open it');
        const err = h('p', { class: 'error', role: 'alert' });
        open.addEventListener('click', async () => {
          // Off before anything is awaited: a second tap makes no second key.
          if (open.disabled) return;
          open.disabled = true;
          err.textContent = '';
          try {
            // Put on this phone since the question (another window of this browser): it opens as it is,
            // never taken over or keyed again.
            if (await db.getWorldRecord(w.id)) {
              await clearPendingOpen(want);
              if (current()) land(want!);
              return;
            }
            // The question was asked for one account: another sign-in since asks again.
            if ((await accountToken()) !== token) {
              void render();
              return;
            }
            const rec = await openAccountWorld(w, token);
            await clearPendingOpen(want);
            if (current()) land({ world: rec.id, element: want?.element });
          } catch (e) {
            err.textContent = errorText(e);
            open.disabled = false;
          }
        });
        body.replaceChildren(
          h('p', { style: 'margin:0' }, 'Open ', h('b', null, w.name), ' on this phone?'),
          whose ? h('p', { class: 'muted small', style: 'margin:0' }, whose) : '',
          open,
          err,
          notNow(),
        );
        return;
      }
    }
  };
  void render();
  return main;
}
