// Lantern's shell: the look, the worker, the router, and keeping open worlds in step.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './themes/theme-warm.css';
import './themes/theme-house.css';
import './style.css';

import './install'; // listens for the browser's install offer from the first moment
import * as db from './db';
import { accountToken, SIGNED_IN_SIGNAL } from './account';
import { applyTheme, checkForUpdate, currentTheme } from './app-state';
import { openWorld, type WorldSession } from './world';
import { keyView, newWorldView, settingsView, signingInView, signInView, welcomeView, worldsView } from './views/start';
import { elementView, homeView, notFound, setBehindReload, typeView, type View } from './views/world';
import { captureView } from './views/capture';
import { outboxView } from './views/outbox';
import { askView } from './views/ask';
import { sortView } from './views/sort';
import { beforeNowView } from './views/time';
import { notesView } from './views/notes';
import { mapView } from './views/map';
import { shareView } from './views/share';
import { consumeShared, peekShared, takeShared } from './share';
import { joinCode, pendingJoin } from './join';
import { joinView } from './views/join';
import { isType, setTypeWordsSource } from './schema';
import { elName, errorText, go, toast } from './ui';
import { applySignInOutcome, isSignInCallback, NOT_KEPT_LINE, setSignInNotice, SIGNING_IN_HASH, startSignInCallback, takeSignedInLine, type SignInOutcome } from './signin';

// Back from onlyworlds.com (Sign in with OnlyWorlds): the exchange starts before anything else asks
// onlyworlds.com, and the address is /#/signing-in before the router or the share target reads it.
const signInReturn: Promise<SignInOutcome> | null = isSignInCallback() ? startSignInCallback() : null;
// Applied once, whatever redraws the screen (a page brought back by Back routes again: the sign-in
// code gate's C11). A failure keeping the token is said, never a screen left on Signing in (G10).
const signInLanding: Promise<string> | null = signInReturn
  ? signInReturn.then(applySignInOutcome).catch((e: unknown) => {
      console.warn('[sign-in] not kept:', e);
      setSignInNotice(NOT_KEPT_LINE);
      return '#/signin';
    })
  : null;

applyTheme(currentTheme());

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
const pulledThisLaunch = new Set<string>();
let activeSession: WorldSession | null = null;
// Every type word asks the open world's record for its own words (src/schema.ts typeName).
setTypeWordsSource(() => activeSession?.rec);

function mount(view: View | HTMLElement, s?: WorldSession): void {
  cleanup?.();
  cleanup = null;
  const v: View = view instanceof HTMLElement ? { el: view } : view;
  app.replaceChildren(v.el);
  window.scrollTo(0, 0);
  const unsubscribe = s && v.refresh ? s.subscribe(v.refresh) : null;
  cleanup = () => {
    unsubscribe?.();
    v.destroy?.();
  };
}

async function route(): Promise<void> {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  activeSession = null;

  if (parts[0] === 'w' && parts[1]) {
    let s: WorldSession;
    try {
      s = await openWorld(parts[1]);
    } catch (e) {
      mount(notFound(errorText(e), '#/worlds'));
      return;
    }
    activeSession = s;
    void db.persistStorage();
    if (!pulledThisLaunch.has(s.id) && !s.isLocal) {
      pulledThisLaunch.add(s.id);
      void s.pull().then(() => s.flush());
      void s.learnWhoIAm();
    }
    const sub = parts[2];
    if (!sub) mount(homeView(s), s);
    else if (sub === 't' && parts[3] && isType(parts[3])) mount(typeView(s, parts[3], query === 'unsorted'), s);
    else if (sub === 'e' && parts[3]) mount(elementView(s, parts[3], query === 'fill'), s);
    else if (sub === 'capture' && s.canWrite) mount(captureView(s, query === 'shared'), s);
    else if (sub === 'outbox') mount(outboxView(s), s);
    else if (sub === 'notes' && s.takesNotes) mount(notesView(s), s);
    else if (sub === 'ask') mount(askView(s), s);
    else if (sub === 'sort') mount(sortView(s), s);
    else if (sub === 'time') mount(beforeNowView(s), s);
    else if (sub === 'map' && parts[3]) {
      const q = new URLSearchParams(query);
      mount(mapView(s, { map: parts[3], pin: q.get('pin') ?? undefined, marker: q.get('marker') ?? undefined, zone: q.get('zone') ?? undefined }), s);
    }
    else mount(notFound('That page is not in Lantern.', `#/w/${s.id}`));
    return;
  }

  switch (parts[0] ?? '') {
    case '':
    case 'worlds': {
      const [worlds, token] = await Promise.all([db.listWorlds(), accountToken()]);
      if (!worlds.length && !token && parts[0] !== 'worlds') mount(welcomeView());
      else mount(worldsView());
      return;
    }
    case 'welcome':
      mount(welcomeView());
      return;
    case 'signin':
      mount(signInView());
      return;
    case 'signing-in': {
      if (!signInLanding) {
        go('#/', true);
        return;
      }
      mount(signingInView());
      const to = await signInLanding;
      if (location.hash === SIGNING_IN_HASH) go(to, true);
      // Who the phone is signed in as, said where the return lands (the sign-in gate's G1).
      const said = takeSignedInLine();
      if (said) toast(said);
      return;
    }
    case 'key':
      mount(keyView());
      return;
    case 'new':
      mount(newWorldView());
      return;
    case 'settings':
      mount(settingsView());
      return;
    case 'share':
      mount(await shareView());
      return;
    case 'catch':
      mount(await shareView(true));
      return;
    case 'join': {
      // keel's join page hands the code on as #/join/<code>. It leaves the address bar
      // at once, as Atlas's door clears it, so a spent code never sits in history; replaceState
      // fires no hashchange, so this screen is the one that opens.
      const fromLink = joinCode(parts[1] ?? '');
      if (fromLink) history.replaceState(null, '', '/#/join');
      mount(await joinView(fromLink ?? sharedJoin));
      sharedJoin = null;
      return;
    }
    default:
      mount(notFound('That page is not in Lantern.'));
  }
}

window.addEventListener('hashchange', () => void route());
// A page the browser kept and brought back (Back from onlyworlds.com) is drawn again, so a screen
// left mid-tap with its buttons off, or signed out in memory, is never what shows (the sign-in gate's G3).
window.addEventListener('pageshow', (e) => {
  if (e.persisted) void route();
});
// Signed in from another window of this browser (a sign-in that came back in a browser tab while the
// home-screen app waited): a screen that only asks to sign in moves on (the sign-in gate's G4).
// Only the welcome and sign-in screens move: Your worlds is left as it is (the sign-in code gate's C6).
async function signedInElsewhere(): Promise<void> {
  if (!app.querySelector('[data-screen="welcome"], [data-screen="signin"]')) return;
  if (!(await accountToken())) return;
  go((await pendingJoin()) ? '#/join' : '#/worlds', true);
}
window.addEventListener('storage', (e) => {
  if (e.key === SIGNED_IN_SIGNAL) void signedInElsewhere();
});
// replaceState fires no hashchange: one route, so one catch screen takes the note.
// A shared invite link goes to the join screen instead of becoming a note.
let sharedJoin: string | null = null;
if (takeShared()) {
  const code = joinCode(peekShared() ?? '');
  if (code) {
    sharedJoin = code;
    consumeShared();
  }
  history.replaceState(null, '', code ? '/#/join' : '/#/share');
}
void route();

// ---------- staying in step ----------

window.addEventListener('online', () => {
  if (activeSession) void activeSession.flush().then(() => activeSession?.pull());
});

/** Reach the new build: find (or fetch) the waiting worker, let it take over, and reload. */
let askedForNewBuild = false;
async function reloadToNewBuild(): Promise<void> {
  askedForNewBuild = true;
  const r = navigator.serviceWorker?.controller ? await navigator.serviceWorker.getRegistration() : undefined;
  if (!r) {
    location.reload();
    return;
  }
  if (!r.waiting && !r.installing) await r.update().catch(() => undefined);
  const w = r.waiting ?? r.installing;
  if (!w) {
    location.reload();
    return;
  }
  const activate = () => w.postMessage('skip-waiting');
  if (w.state === 'installed') activate();
  else w.addEventListener('statechange', () => w.state === 'installed' && activate());
  // If the worker never takes over (a refused precache), reload anyway after a while.
  window.setTimeout(() => location.reload(), 10000);
}

function onBehind(): void {
  setBehindReload(() => void reloadToNewBuild());
  // Show the banner without remounting: a remount would wipe whatever is being typed.
  activeSession?.touch();
}

// While the app is open and in front, it looks for changes now and then, quietly: what the game
// master gives the party reaches a player's phone during the session, not at the next launch.
// Hidden, it stops (the return to the front pulls at once, below).
const POLL_MS = 20_000;
window.setInterval(() => {
  const s = activeSession;
  if (document.visibilityState !== 'visible' || !navigator.onLine || !s) return;
  // A key keel no longer takes is said once; asking every 20 s would not change the answer.
  if (s.keyRefused) return;
  // Changes still waiting go with it: a send that failed while the phone thought it had signal
  // is tried again here, so its banner comes back instead of the poll quietly clearing it.
  void s.pull(true).then(() => {
    // A player told of what just arrived (a reveal at the table), wherever they are in the app.
    const fresh = s.arrived.splice(0).filter((e) => e.type !== 'pin' && e.type !== 'marker');
    if (fresh.length && s.rec.memberRole === 'guest' && s === activeSession) {
      toast(fresh.length === 1 ? `New: ${elName(fresh[0])}` : `${fresh.length} new things you know`);
    }
    return s.waitingCount() && (!s.needPin || s.pinKnown()) ? s.flush() : undefined;
  });
}, POLL_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  void signedInElsewhere();
  void checkForUpdate(onBehind);
  if (activeSession && navigator.onLine) void activeSession.pull().then(() => activeSession?.flush());
});

// ---------- the worker: the app opens without signal ----------

// The worker itself, not the name: an in-app browser can have the name and no worker. And a
// registration can come back empty where workers are blocked (Playwright's block does it).
if (navigator.serviceWorker && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg?.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) void checkForUpdate(onBehind);
      });
    });
  });
  // Only the reload the user asked for. The first install's clients.claim() also changes the
  // controller, and reloading then would wipe a form mid-typing (the live walk caught it).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (askedForNewBuild) location.reload();
  });
}
void checkForUpdate(onBehind);
