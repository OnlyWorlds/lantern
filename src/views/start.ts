// The screens before a world: the first open, signing in, a key, a new world, your worlds, settings.
import { h } from '../dom';
import { ago, plural } from '../dom';
import { icon } from '../icons';
import * as db from '../db';
import {
  DEMO_KEY,
  accountToken,
  cachedAccountWorlds,
  fetchAccountWorlds,
  openAccountWorld,
  openWithKey,
  signIn,
  signInWithPassword,
  signOut,
  type AccountWorld,
} from '../account';
import { setSessionPin, forgetSession } from '../world';
import { uuid7 } from '../uuid7';
import { openWorldFile, saveFile, toWorldFile } from '../worldfile';
import { errorText, go, isStandalone, toast, topbar } from '../ui';
import { applyTheme, currentTheme, BUILD_ID } from '../app-state';

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
      h('span', { style: 'color:var(--lan-accent)' }, icon('lantern', 56, 1.5)),
      h('h1', null, 'Lantern'),
      h('p', null, 'Your worlds in your pocket. Works with Atlas and every OnlyWorlds tool.'),
    ),
    h('div', { class: 'spacer' }),
    isStandalone()
      ? null
      : h(
          'div',
          { class: 'note' },
          icon('phone', 22),
          h('span', null, 'First, add Lantern to your home screen: it opens without signal, and a world you start stays with it.'),
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
        h('span', null, 'No account needed. Put it online whenever you like'),
      ),
      h('a', { class: 'btn btn-quiet', href: '#/key', style: 'align-self:center' }, 'I have a world key'),
    ),
  );
}

export function signInView(): HTMLElement {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', autocapitalize: 'off', 'aria-label': 'Email' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const form = h(
    'form',
    { class: 'stack' },
    h('label', { class: 'field-label' }, 'Email', email),
    h('label', { class: 'field-label' }, 'Password', password),
    err,
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!email.value.trim() || !password.value) {
      err.textContent = 'Your email and password, as on onlyworlds.com.';
      return;
    }
    btn.disabled = true;
    try {
      await signInWithPassword(email.value, password.value);
      go('#/worlds', true);
    } catch (ex) {
      err.textContent = errorText(ex);
    } finally {
      btn.disabled = false;
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
      go('#/worlds', true);
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
    form,
    reveal,
    tokenForm,
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
      if (pin.value.trim()) setSessionPin(rec.id, pin.value.trim());
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
    const rec: db.WorldRecord = { id: uuid7(), name: n, kind: 'local', addedAt: new Date().toISOString(), count: 0 };
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

function saveCopyButton(rec: db.WorldRecord): HTMLElement {
  const b = h('button', { class: 'btn', type: 'button', style: 'color:var(--lan-accent)' }, 'Save a copy');
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const { bytes, name } = toWorldFile(rec, await db.allElements(rec.id));
      const how = await saveFile(bytes, name);
      await db.updateWorldRecord(rec.id, { lastCopy: new Date().toISOString() });
      toast(how === 'shared' ? 'Copy handed over.' : `Saved ${name}.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(errorText(e));
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

function openFileButton(): HTMLElement {
  const input = h('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none', 'aria-label': 'A world file' });
  const b = h('button', { class: 'btn', type: 'button' }, 'Open a world file', input);
  b.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const id = await openWorldFile(new Uint8Array(await f.arrayBuffer()));
      go(`#/w/${id}`);
    } catch (e) {
      toast(errorText(e));
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

    if (token) {
      const list = h('div', { class: 'stack' }, h('p', { class: 'section-label' }, 'Online'));
      for (const w of acct) {
        const rec = byId.get(w.id);
        if (rec) list.appendChild(worldCard(rec, waiting.get(w.id) ?? 0));
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
          list.appendChild(card);
        }
      }
      if (!acct.length) list.appendChild(h('p', { class: 'muted', style: 'margin:0' }, 'No worlds on this account yet.'));
      main.appendChild(list);
    }

    const keyed = recs.filter((r) => r.kind === 'online' && !acct.some((a) => a.id === r.id));
    if (keyed.length) {
      main.appendChild(
        h(
          'div',
          { class: 'stack' },
          h('p', { class: 'section-label' }, token ? 'Opened with a key' : 'Online'),
          ...keyed.map((r) => worldCard(r, waiting.get(r.id) ?? 0)),
        ),
      );
    }

    const local = recs.filter((r) => r.kind === 'local');
    if (local.length) {
      main.appendChild(
        h(
          'div',
          { class: 'stack' },
          h('p', { class: 'section-label' }, 'On this phone only'),
          ...local.map((r) => h('div', { class: 'local-group' }, worldCard(r, 0), saveCopyButton(r))),
        ),
      );
    }

    const demos = recs.filter((r) => r.kind === 'demo');
    if (demos.length) {
      main.appendChild(h('div', { class: 'stack' }, h('p', { class: 'section-label' }, 'Demo'), ...demos.map((r) => worldCard(r, 0))));
    }

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
    if (!demos.length) {
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
    const keep = h('button', { class: 'btn', type: 'button' }, 'Ask the phone to keep your worlds');
    keep.addEventListener('click', async () => {
      const ok = await db.persistStorage();
      toast(ok ? 'The phone will keep your worlds.' : 'The phone did not agree yet. Adding Lantern to the home screen helps.');
      void render();
    });
    const out = h('button', { class: 'btn', type: 'button' }, 'Sign out');
    out.addEventListener('click', async () => {
      await signOut();
      toast('Signed out. Worlds already on this phone stay.');
      void render();
    });
    main.replaceChildren(
      topbar('Settings', '#/worlds'),
      h('p', { class: 'section-label' }, 'Look'),
      h('div', { class: 'row-gap' }, themeBtn('warm', 'Warm'), themeBtn('house', 'House')),
      h('p', { class: 'section-label' }, 'Account'),
      token
        ? h('div', { class: 'stack' }, h('p', { class: 'dim', style: 'margin:0' }, 'Signed in. This phone has its own key to your account.'), out)
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
      h('div', { class: 'spacer' }),
      h('p', { class: 'muted small', style: 'margin:0' }, `Lantern · build ${BUILD_ID}`),
    );
  };
  void render();
  return main;
}

export async function removeWorldFromPhone(id: string): Promise<void> {
  forgetSession(id);
  await db.removeWorld(id);
}
