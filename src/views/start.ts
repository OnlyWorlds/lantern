// The screens before a world: the first open, signing in, a key, a new world, your worlds, settings.
import { h } from '../dom';
import { ago, plural } from '../dom';
import { icon } from '../icons';
import * as db from '../db';
import {
  DEMO_KEY,
  accountName,
  accountToken,
  cachedAccountWorlds,
  fetchAccountWorlds,
  openAccountWorld,
  openWithKey,
  signIn,
  signInWithPassword,
  signOut,
  signedOutLine,
  type AccountWorld,
} from '../account';
import type { RevokeOutcome } from '../revoke';
import { forgetSession } from '../world';
import { setPin } from '../pin';
import { pendingJoin } from '../join';
import { SIGNUP_URL } from '../invite';
import { uuid7 } from '../uuid7';
import { lanternProducer, openWorldFile, saveFile, worldCopy, type CopyQuestion } from '../worldfile';
import { PinNeeded, putOnline } from '../online';
import { errorText, go, sheet, toast, topbar } from '../ui';
import { beginOnlyWorldsSignIn, canSignInWithOnlyWorlds, takeSignInNotice } from '../signin';
import { installButton, onHomeScreen } from '../install';
import { applyTheme, currentTheme, fieldsShown, setFieldsShown, BUILD_ID, type FieldsShown } from '../app-state';

export function welcomeView(): HTMLElement {
  const busy = { on: false };
  const demo = async (btn: HTMLButtonElement) => {
    if (busy.on) return;
    busy.on = true;
    btn.disabled = true;
    try {
      const rec = await openWithKey(DEMO_KEY);
      go(`#/w/${rec.id}`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy.on = false;
      btn.disabled = false;
    }
  };
  const demoBtn = h(
    'button',
    { class: 'choice', type: 'button' },
    h('b', null, 'Explore Moppetopia'),
    h('span', null, 'A demo world, nothing to sign up for'),
  );
  demoBtn.addEventListener('click', () => demo(demoBtn));

  return h(
    'main',
    { class: 'screen', 'data-screen': 'welcome' },
    h(
      'div',
      { class: 'welcome-mark' },
      h('img', { src: '/ow-globe.png', width: '64', height: '64', alt: '' }),
      h('h1', null, 'Lantern'),
      h('p', null, 'Your worlds in your pocket. Works with Atlas and every OnlyWorlds tool.'),
    ),
    h('div', { class: 'spacer' }),
    onHomeScreen()
      ? null
      : h(
          'div',
          { class: 'note' },
          icon('phone', 22),
          h(
            'div',
            { class: 'stack', style: 'gap:10px;flex-grow:1' },
            h('span', null, 'First, add Lantern to your home screen: it opens without signal, and a world you start stays with it.'),
            installButton(),
          ),
        ),
    h(
      'div',
      { class: 'stack' },
      h(
        'a',
        { class: 'choice primary', href: '#/signin' },
        h('b', null, 'Sign in to OnlyWorlds'),
        h('span', null, 'Your worlds, the same ones Atlas opens'),
      ),
      demoBtn,
      h(
        'a',
        { class: 'choice', href: '#/new' },
        h('b', null, 'Start a world on this phone'),
        h('span', null, 'No account needed. Put it online later'),
      ),
      h('a', { class: 'btn btn-quiet', href: '#/join', style: 'align-self:center' }, 'I have an invite link'),
      h('a', { class: 'btn btn-quiet', href: '#/key', style: 'align-self:center' }, 'I have a world key'),
      // A world file sent by a friend, on a phone with nothing on it yet (S434: the door was only on Your worlds).
      openFileButton('I have a world file', { class: 'btn btn-quiet', style: 'align-self:center' }),
    ),
  );
}

export function signInView(): HTMLElement {
  // An email or a username (SDK 4.31): type text, so a username is not refused as a bad email.
  const email = h('input', { class: 'input', type: 'text', inputmode: 'email', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Email or username' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const err = h('p', { class: 'error', role: 'alert' });
  // Sign in with OnlyWorlds (Keel #515): the screen's main act where it is offered, so the
  // password form's Sign in steps down to a Standard button beside it (the house ladder).
  const handoff = canSignInWithOnlyWorlds();
  const btn = h('button', { class: handoff ? 'btn btn-standard' : 'btn btn-primary', type: 'submit' }, 'Sign in');
  // One sign-in at a time (L8): the form waits while the tap is leaving, and the tap while the form submits.
  const busy = { on: false };
  // The round trip's own line (a refusal on return, no signal at the tap): an error only while it has
  // words, so an empty one is never the screen's first error.
  const notice = h('p', { role: 'alert', 'data-part': 'signin-notice' });
  const say = (line: string) => {
    notice.textContent = line;
    notice.className = line ? 'error' : '';
  };
  say(takeSignInNotice() ?? '');
  const owBtn = handoff ? h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'signin-onlyworlds' }, 'Sign in with OnlyWorlds') : null;
  // Whose account it is: the browser's onlyworlds.com sign-in decides, with no page after the first
  // (the S470 gate's G1), so the screen says so before the tap. Shown once the phone is read as
  // signed out (L9), never for a moment on a signed-in one (G11).
  const handoffPart = owBtn
    ? h(
        'div',
        { class: 'stack', hidden: true, 'data-part': 'signin-handoff' },
        owBtn,
        h('p', { class: 'dim small', style: 'margin:0' }, 'It uses the account signed in on onlyworlds.com in this browser.'),
        h('p', { class: 'dim', style: 'margin:0' }, 'or with your email or username and password'),
      )
    : null;
  owBtn?.addEventListener('click', async () => {
    if (busy.on) return;
    busy.on = true;
    owBtn.disabled = true;
    btn.disabled = true;
    say('');
    try {
      await beginOnlyWorldsSignIn();
    } catch (ex) {
      say(errorText(ex));
      busy.on = false;
      owBtn.disabled = false;
      btn.disabled = false;
    }
  });
  // Signed in already, the round trip would only replace the token: no button (L9).
  if (handoffPart) void accountToken().then((t) => {
    if (t) handoffPart.remove();
    else handoffPart.hidden = false;
  });
  const form = h(
    'form',
    { class: 'stack' },
    h('label', { class: 'field-label' }, 'Email or username', email),
    h('label', { class: 'field-label' }, 'Password', password),
    err,
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!email.value.trim() || !password.value) {
      err.textContent = 'Your email or username and password, as on onlyworlds.com.';
      return;
    }
    if (busy.on) return;
    busy.on = true;
    btn.disabled = true;
    if (owBtn) owBtn.disabled = true;
    try {
      await signInWithPassword(email.value, password.value);
      go((await pendingJoin()) ? '#/join' : '#/worlds', true);
    } catch (ex) {
      err.textContent = errorText(ex);
    } finally {
      busy.on = false;
      btn.disabled = false;
      if (owBtn) owBtn.disabled = false;
    }
  });

  // The older door: a token made on onlyworlds.com, pasted.
  const token = h('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'ow_a_…',
    'aria-label': 'Account token',
  });
  const tokenErr = h('p', { class: 'error', role: 'alert' });
  const tokenForm = h(
    'form',
    { class: 'stack', hidden: true },
    h('label', { class: 'field-label' }, 'Account token', token),
    tokenErr,
    h('button', { class: 'btn', type: 'submit' }, 'Sign in with the token'),
  );
  tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    tokenErr.textContent = '';
    try {
      await signIn(token.value);
      go((await pendingJoin()) ? '#/join' : '#/worlds', true);
    } catch (ex) {
      tokenErr.textContent = errorText(ex);
    }
  });
  const reveal = h('button', { class: 'btn btn-quiet', type: 'button' }, 'I have an account token');
  reveal.addEventListener('click', () => {
    tokenForm.hidden = false;
    reveal.remove();
    token.focus();
  });

  return h(
    'main',
    { class: 'screen', 'data-screen': 'signin' },
    topbar('Sign in', '#/'),
    h('p', { class: 'dim', style: 'margin:0' }, 'Your OnlyWorlds account. This phone keeps its own key, which you can take back on onlyworlds.com.'),
    notice,
    handoffPart,
    form,
    reveal,
    tokenForm,
    // No account yet (S407): an invited friend lands here, and only the website makes one.
    h(
      'p',
      { class: 'dim', 'data-part': 'no-account', style: 'margin:0' },
      'No account yet? ',
      h('a', { href: SIGNUP_URL, target: '_blank', rel: 'noopener' }, 'Make a free one on onlyworlds.com'),
      ', then sign in here.',
    ),
  );
}

/** Back from onlyworlds.com while the code is traded for this phone's token. */
export function signingInView(): HTMLElement {
  return h(
    'main',
    { class: 'screen', 'data-screen': 'signing-in' },
    // No way back from here: the outcome lands where this screen goes (the S470 gate's G9).
    topbar('Sign in'),
    h('p', { class: 'dim', role: 'status', style: 'margin:0' }, 'Signing in…'),
  );
}

export function keyView(): HTMLElement {
  const key = h('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'ow_w_… or ow_r_…',
    'aria-label': 'World key',
  });
  const pin = h('input', {
    class: 'input',
    type: 'password',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: '4',
    placeholder: '4 digits',
    'aria-label': 'PIN',
  });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Open the world');
  const form = h(
    'form',
    { class: 'stack' },
    h('label', { class: 'field-label' }, 'World key', key),
    h('label', { class: 'field-label' }, 'PIN (only to make changes)', pin),
    err,
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      const rec = await openWithKey(key.value, pin.value.trim() || undefined);
      if (pin.value.trim()) setPin(rec, pin.value.trim());
      go(`#/w/${rec.id}`, true);
    } catch (ex) {
      const m = errorText(ex);
      err.textContent = /PIN/i.test(m) ? 'That PIN does not open this world.' : m;
    } finally {
      btn.disabled = false;
    }
  });
  return h('main', { class: 'screen', 'data-screen': 'key' }, topbar('Open with a key', '#/'), form);
}

export function newWorldView(): HTMLElement {
  const name = h('input', { class: 'input', type: 'text', placeholder: 'Bus stop ideas', 'aria-label': 'World name' });
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h(
    'form',
    { class: 'stack' },
    h('label', { class: 'field-label' }, 'Name', name),
    err,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Start the world'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) {
      err.textContent = 'Give it a name.';
      return;
    }
    const rec: db.WorldRecord = { id: uuid7(), name: n, kind: 'local', addedAt: new Date().toISOString(), count: 0, producer: lanternProducer() };
    await db.putWorldRecord(rec);
    void db.persistStorage();
    go(`#/w/${rec.id}`, true);
  });
  return h(
    'main',
    { class: 'screen', 'data-screen': 'new-world' },
    topbar('A new world', '#/'),
    h(
      'p',
      { class: 'dim', style: 'margin:0' },
      'It lives on this phone only, with no account. Sign in later to put it online and open it in Atlas.',
    ),
    form,
  );
}

function worldCard(rec: db.WorldRecord, waiting: number): HTMLElement {
  const thumb = h('div', { class: 'thumb' });
  if (rec.image_url && /^https:\/\//.test(rec.image_url)) thumb.style.backgroundImage = `url("${rec.image_url}")`;
  const bits: string[] = [];
  if (rec.count !== undefined) bits.push(plural(rec.count, 'element'));
  if (rec.kind === 'local') bits.push('kept by this phone');
  else if (rec.kind === 'demo') bits.push('demo, read only');
  else if (rec.memberRole === 'guest') bits.push('you are a player (guest)');
  else if (rec.keyKind === 'read') bits.push('read only');
  if (rec.kind !== 'local') bits.push(rec.lastSync ? `synced ${ago(rec.lastSync)}` : 'not fetched yet');
  return h(
    'a',
    { class: 'world-card', href: `#/w/${rec.id}`, 'data-world': rec.id },
    thumb,
    h('div', { class: 'text' }, h('b', null, rec.name || 'Unnamed world'), h('span', null, bits.join(' · '))),
    waiting ? h('span', { class: 'small', style: 'color:var(--lan-accent)' }, `${waiting} waiting`) : null,
  );
}

// Pinned worlds, on this phone: an ordered list of ids. A per-phone convenience, so it lives in
// localStorage; losing it loses only the order.
const PINNED_KEY = 'lantern-pinned-worlds';
function readPinned(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function togglePinned(id: string): void {
  const now = readPinned();
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(next));
  } catch {
    toast('This phone would not keep the pin.');
  }
}

/** A world's card with its pin beside it: a separate tap, never inside the card's own link. */
function pinRow(id: string, card: HTMLElement, on: boolean, after: () => void): HTMLElement {
  const b = h(
    'button',
    { class: `pin-btn${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': on ? 'Unpin this world' : 'Pin this world to the top', 'data-pin': id },
    icon('pin', 18, on ? 2.4 : 1.8),
  );
  b.addEventListener('click', () => {
    togglePinned(id);
    after();
  });
  return h('div', { class: 'pin-row' }, card, b);
}

function saveCopyButton(rec: db.WorldRecord): HTMLElement {
  const b = h('button', { class: 'btn', type: 'button', style: 'color:var(--lan-accent)' }, 'Save a copy');
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const elements = await db.allElements(rec.id);
      const kept = [...(await db.getRecords(rec.id)), ...(await db.getMedia(rec.id))];
      const made = worldCopy(rec, elements, kept);
      if (made.question) privateRecordsSheet(made.question, made.bytes && { bytes: made.bytes, name: made.name }, () => worldCopy(rec, elements, kept, true), rec.id);
      else if (made.bytes) await handOver(rec.id, made.bytes, made.name);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(errorText(e));
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

async function handOver(id: string, bytes: Uint8Array, name: string): Promise<void> {
  const how = await saveFile(bytes, name);
  await db.updateWorldRecord(id, { lastCopy: new Date().toISOString() });
  toast(how === 'shared' ? 'Copy handed over.' : `Saved ${name}.`);
}

/**
 * Records a tool keeps private stay out of a copy unless the person asks (folder spec §4.5 rule
 * 11, Atlas's question in 1.82.0). A records list that will not read leaves nothing out by guess:
 * every record, or no copy. Each choice is its own tap, so the share sheet opens from it.
 */
function privateRecordsSheet(
  q: CopyQuestion,
  leftOut: { bytes: Uint8Array; name: string } | null,
  withAll: () => { bytes: Uint8Array | null; name: string },
  id: string,
): void {
  const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const unreadable = q.kind === 'unreadable';
  const title = unreadable ? 'Lantern cannot tell which records are private' : 'Some records are private';
  sheet((close) => {
    const choose = (pick: () => { bytes: Uint8Array | null; name: string } | null) => async () => {
      const made = pick();
      close();
      if (!made?.bytes) return;
      try {
        await handOver(id, made.bytes, made.name);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') toast(errorText(e));
      }
    };
    const all = h('button', { class: 'btn', type: 'button', 'data-records': 'include' }, unreadable ? 'Include every record' : 'Include them');
    all.addEventListener('click', choose(withAll));
    const other = unreadable
      ? h('button', { class: 'btn', type: 'button', 'data-records': 'cancel' }, 'Cancel')
      : h('button', { class: 'btn btn-standard', type: 'button', 'data-records': 'leave-out' }, 'Leave them out');
    other.addEventListener('click', unreadable ? () => close() : choose(() => leftOut));
    const what =
      q.kind === 'private'
        ? `This world holds records ${q.producers.length === 1 ? 'a tool keeps' : 'tools keep'} private: ${list(q.producers.map((p) => `records/${p}`))}. A copy leaves them out unless you ask, so a tool's own notes stay with you when the world is shared.`
        : "This world's records list (records/RECORDS.json) cannot be read, so Lantern cannot tell which records their tools keep private, and leaves nothing out by guess.";
    return [
      h('h2', null, title),
      h('p', { class: 'dim', style: 'margin:0' }, what),
      h('p', { class: 'dim', style: 'margin:0' }, unreadable ? 'Include every record only in a copy you keep for yourself.' : 'Include them only in a copy you keep for yourself.'),
      h('div', { class: 'row-gap' }, other, all),
    ];
  }, title);
}

function putOnlineButton(rec: db.WorldRecord, signedIn: boolean): HTMLElement {
  const b = h('button', { class: 'btn btn-standard', type: 'button' }, 'Put it online');
  b.addEventListener('click', () => {
    if (!signedIn) {
      toast('Sign in first, then put it online.');
      go('#/signin');
      return;
    }
    sheet((close) => {
      const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', 'aria-label': 'PIN' });
      const step = h('p', { class: 'muted small', role: 'status', style: 'margin:0' });
      const err = h('p', { class: 'error', role: 'alert' });
      const go1 = h('button', { class: 'btn btn-standard', type: 'submit' }, 'Put it online');
      const form = h('form', { class: 'stack' }, h('label', { class: 'field-label' }, 'Your PIN', pin), step, err, go1);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (!/^\d{4}$/.test(pin.value.trim())) {
          err.textContent = 'Four digits.';
          return;
        }
        go1.disabled = true;
        try {
          const id = await putOnline(rec.id, pin.value.trim(), (t) => (step.textContent = t));
          close();
          toast(`${rec.name} is online. Atlas opens it too.`);
          go(`#/w/${id}`, true);
        } catch (ex) {
          step.textContent = '';
          err.textContent =
            ex instanceof PinNeeded
              ? 'Your account has no PIN yet: these four digits become it (from 1000 to 9999).'
              : /PIN|credential/i.test(errorText(ex))
                ? 'That PIN does not match your account.'
                : errorText(ex);
          go1.disabled = false;
        }
      });
      return [
        h('h2', null, `Put ${rec.name} online`),
        h(
          'p',
          { class: 'dim', style: 'margin:0' },
          'It becomes a world on your account, the same one Atlas opens, and this phone keeps working on it. The four digits are your PIN for changes; if your account has none yet, these become it.',
        ),
        form,
      ];
    }, 'Put it online');
  });
  return b;
}

/** Open a world file. The welcome's quiet "I have a world file" is the same door for a phone with no world yet. */
function openFileButton(words = 'Open a world file', attrs: Record<string, string> = { class: 'btn' }): HTMLElement {
  // The standard's .owworld beside the .zip Atlas and Lantern save: one file (folder spec 4.7 OW-1), and the bytes decide.
  const input = h('input', { type: 'file', accept: '.owworld,.zip,application/zip', style: 'display:none', 'aria-label': 'A world file' });
  const label = h('span', null, words);
  const b = h('button', { ...attrs, type: 'button' }, label, input);
  b.addEventListener('click', (e) => {
    if (e.target !== input && !b.disabled) input.click();
  });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    // A big world takes a while to store (seconds in WebKit): say so, and take no second file meanwhile.
    b.disabled = true;
    label.textContent = 'Opening the world file…';
    try {
      const id = await openWorldFile(new Uint8Array(await f.arrayBuffer()));
      go(`#/w/${id}`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      b.disabled = false;
      label.textContent = words;
    }
  });
  return b;
}

export function worldsView(): HTMLElement {
  const main = h('main', { class: 'screen', 'data-screen': 'worlds' });
  const render = async (fresh?: AccountWorld[]) => {
    const [recs, token] = await Promise.all([db.listWorlds(), accountToken()]);
    const acct = fresh ?? (await cachedAccountWorlds());
    const waiting = new Map<string, number>();
    await Promise.all(
      recs
        .filter((r) => r.kind !== 'demo')
        .map(async (r) => waiting.set(r.id, (await db.outboxRows(r.id)).filter((x) => x.state !== 'refused').length)),
    );
    const byId = new Map(recs.map((r) => [r.id, r]));
    main.replaceChildren(
      topbar('Your worlds', undefined, h('a', { class: 'btn btn-round', href: '#/settings', 'aria-label': 'Settings' }, icon('settings', 20))),
    );
    // Pinned worlds lead the list, in the order pinned, whatever kind they are (the Captain, #3660).
    // Each card is built once, then placed: under Pinned, or in its own section.
    const pinned = readPinned();
    const pinnedCards = new Map<string, HTMLElement>();
    const place = (id: string, card: HTMLElement, into: HTMLElement[]) => {
      const row = pinRow(id, card, pinned.includes(id), () => void render(acct));
      if (pinned.includes(id)) pinnedCards.set(id, row);
      else into.push(row);
    };
    const pinnedSection = h('div', { class: 'stack' }, h('p', { class: 'section-label' }, 'Pinned'));
    main.appendChild(pinnedSection);

    if (token) {
      const list = h('div', { class: 'stack' }, h('p', { class: 'section-label' }, 'Online'));
      const cards: HTMLElement[] = [];
      for (const w of acct) {
        const rec = byId.get(w.id);
        if (rec) place(w.id, worldCard(rec, waiting.get(w.id) ?? 0), cards);
        else {
          const card = h(
            'button',
            { class: 'world-card', type: 'button', style: 'text-align:left;width:100%', 'data-world': w.id },
            h('div', { class: 'thumb' }),
            h(
              'div',
              { class: 'text' },
              h('b', null, w.name),
              h('span', null, w.member_role === 'guest' ? 'you are a player (guest) · tap to open' : 'tap to open on this phone'),
            ),
          );
          card.addEventListener('click', async () => {
            card.setAttribute('disabled', '');
            try {
              const r = await openAccountWorld(w);
              go(`#/w/${r.id}`);
            } catch (e) {
              toast(errorText(e));
              card.removeAttribute('disabled');
            }
          });
          place(w.id, card, cards);
        }
      }
      if (!acct.length) list.appendChild(h('p', { class: 'muted', style: 'margin:0' }, 'No worlds on this account yet.'));
      list.append(...cards);
      if (acct.length && !cards.length) list.remove();
      else main.appendChild(list);
    }

    const section = (label: string, cards: HTMLElement[]) => {
      if (cards.length) main.appendChild(h('div', { class: 'stack' }, h('p', { class: 'section-label' }, label), ...cards));
    };
    const keyedCards: HTMLElement[] = [];
    for (const r of recs.filter((r) => r.kind === 'online' && !acct.some((a) => a.id === r.id))) place(r.id, worldCard(r, waiting.get(r.id) ?? 0), keyedCards);
    section(token ? 'Opened with a key' : 'Online', keyedCards);

    const localCards: HTMLElement[] = [];
    for (const r of recs.filter((r) => r.kind === 'local')) {
      const group = h('div', { class: 'local-group' }, worldCard(r, 0), h('div', { class: 'row-gap' }, saveCopyButton(r), putOnlineButton(r, !!token)));
      place(r.id, group, localCards);
    }
    section('On this phone only', localCards);

    const demoCards: HTMLElement[] = [];
    for (const r of recs.filter((r) => r.kind === 'demo')) place(r.id, worldCard(r, 0), demoCards);
    section('Demo', demoCards);

    // Pinned, in pin order; a pin for a world no longer here is simply not shown.
    const shown = pinned.filter((id) => pinnedCards.has(id));
    if (shown.length) pinnedSection.append(...shown.map((id) => pinnedCards.get(id)!));
    else pinnedSection.remove();

    main.appendChild(h('div', { class: 'spacer' }));
    main.appendChild(
      h(
        'div',
        { class: 'row-gap' },
        h('a', { class: 'btn', href: '#/new' }, 'New world'),
        openFileButton(),
      ),
    );
    main.appendChild(
      token
        ? h('a', { class: 'btn btn-quiet', href: '#/key', style: 'align-self:center' }, 'Open with a key')
        : h('a', { class: 'btn btn-quiet', href: '#/signin', style: 'align-self:center' }, 'Sign in to OnlyWorlds'),
    );
    main.appendChild(h('a', { class: 'btn btn-quiet', href: '#/join', style: 'align-self:center' }, 'Join with an invite link'));
    if (!recs.some((r) => r.kind === 'demo')) {
      const b = h('button', { class: 'btn btn-quiet', type: 'button', style: 'align-self:center' }, 'Explore Moppetopia');
      b.addEventListener('click', async () => {
        try {
          const rec = await openWithKey(DEMO_KEY);
          go(`#/w/${rec.id}`);
        } catch (e) {
          toast(errorText(e));
        }
      });
      main.appendChild(b);
    }
  };
  void render().then(async () => {
    if ((await accountToken()) && navigator.onLine) {
      try {
        await render(await fetchAccountWorlds());
      } catch {
        /* offline or the token was revoked: the cached list stands */
      }
    }
  });
  return main;
}

export function settingsView(): HTMLElement {
  const main = h('main', { class: 'screen', 'data-screen': 'settings' });
  const render = async () => {
    const token = await accountToken();
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
    const theme = currentTheme();
    const themeBtn = (id: 'warm' | 'house', label: string) => {
      const b = h('button', { class: `side${theme === id ? ' on' : ''}`, type: 'button', 'aria-pressed': String(theme === id) }, h('b', null, label));
      b.addEventListener('click', () => {
        applyTheme(id);
        void render();
      });
      return b;
    };
    const fields = fieldsShown();
    const fieldsBtn = (id: FieldsShown, label: string) => {
      const b = h('button', { class: `side${fields === id ? ' on' : ''}`, type: 'button', 'aria-pressed': String(fields === id), 'data-fields': id }, h('b', null, label));
      b.addEventListener('click', () => {
        setFieldsShown(id);
        void render();
      });
      return b;
    };
    const fieldsSaid =
      fields === 'all'
        ? 'Every field shows, the empty ones too.'
        : fields === 'own'
          ? "Only the fields you added show. The type's own fields are a tap away."
          : 'The filled fields show. The empty ones are a tap away.';
    const keep = h('button', { class: 'btn', type: 'button' }, 'Ask the phone to keep your worlds');
    keep.addEventListener('click', async () => {
      const ok = await db.persistStorage();
      toast(ok ? 'The phone will keep your worlds.' : 'The phone did not agree yet. Adding Lantern to the home screen helps.');
      void render();
    });
    const out = h('button', { class: 'btn', type: 'button' }, 'Sign out');
    out.addEventListener('click', async () => {
      // One sign-out per tap: a second tap would say the line twice (the S476 gate's notes).
      out.setAttribute('disabled', '');
      const { revoking } = await signOut();
      void render();
      void saySignedOut(revoking, 'Worlds already on this phone stay.');
    });
    // On a shared phone the next person can read what stays (the security pass, F2; the Captain
    // h37 #4072: offered, not the default). The account's worlds are the ones with a role, as the PIN's are.
    const mine = token ? (await db.listWorlds()).filter((w) => w.role) : [];
    const who = await accountName();
    let unsent = 0;
    for (const w of mine) unsent += (await db.outboxRows(w.id)).length;
    const outAll = h(
      'button',
      { class: 'btn btn-quiet', type: 'button', 'data-action': 'sign-out-remove' },
      `Sign out and remove your ${plural(mine.length, 'world')} from this phone`,
    );
    let armed = false;
    outAll.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        outAll.textContent = unsent
          ? `Remove them? ${plural(unsent, 'change')} not sent yet go with them. Tap again.`
          : `Remove ${mine.length === 1 ? 'it' : 'them'} from this phone? Tap again.`;
        return;
      }
      outAll.setAttribute('disabled', '');
      for (const w of mine) await removeWorldFromPhone(w.id);
      const { revoking } = await signOut();
      void render();
      void saySignedOut(revoking, `${plural(mine.length, 'world')} removed from this phone.`);
    });
    main.replaceChildren(
      topbar('Settings', '#/worlds'),
      h('p', { class: 'section-label' }, 'Look'),
      h('div', { class: 'row-gap' }, themeBtn('warm', 'Warm'), themeBtn('house', 'House')),
      h('p', { class: 'section-label' }, 'Fields on a page'),
      h('div', { class: 'row-gap' }, fieldsBtn('filled', 'Filled'), fieldsBtn('all', 'All'), fieldsBtn('own', 'Yours')),
      h('p', { class: 'dim', style: 'margin:0' }, fieldsSaid),
      h('p', { class: 'section-label' }, 'Account'),
      token
        ? h('div', { class: 'stack' }, h('p', { class: 'dim wrap-name', style: 'margin:0', 'data-part': 'signed-in-as' }, `${who ? `Signed in as ${who}.` : 'Signed in.'} This phone has its own key to your account.`), out, mine.length ? outAll : '')
        : h('a', { class: 'btn', href: '#/signin' }, 'Sign in to OnlyWorlds'),
      h('p', { class: 'section-label' }, 'This phone'),
      h(
        'p',
        { class: 'dim', style: 'margin:0' },
        persisted === true
          ? 'The phone has agreed to keep your worlds.'
          : persisted === false
            ? 'The phone may clear your worlds when it runs low on space.'
            : 'This browser does not say whether it keeps your worlds.',
      ),
      persisted === false ? keep : '',
      installButton() ?? h('p', { class: 'dim', style: 'margin:0' }, 'Lantern is on your home screen.'),
      h('div', { class: 'spacer' }),
      h('p', { class: 'muted small', style: 'margin:0' }, `Lantern · build ${BUILD_ID}`),
    );
  };
  void render();
  return main;
}

/** Said once the revoke answers; dropped when the phone signed in again meanwhile (its own line is the news). */
async function saySignedOut(revoking: Promise<RevokeOutcome> | null, rest: string): Promise<void> {
  const outcome = revoking ? await revoking : null;
  if (revoking && (await accountToken().catch(() => undefined))) return;
  // The line that asks for a step on onlyworlds.com stays long enough to read.
  toast(signedOutLine(outcome, rest), outcome === 'kept' ? 7000 : undefined);
}

export async function removeWorldFromPhone(id: string): Promise<void> {
  forgetSession(id);
  // A world opened with a key takes its own PIN with it; your account's PIN stays for your other worlds.
  setPin({ id }, undefined);
  // The phone's own lists for it go too (the S402 gate): a shared phone keeps nothing of a removed world.
  for (const k of [`lantern-tonight-${id}`, `lantern-recent-${id}`, `lantern-given-${id}`, `lantern-notes-${id}`]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage refused: the lists name a world no longer here, and show nothing */
    }
  }
  await db.removeWorld(id);
}
